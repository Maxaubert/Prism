import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alphaOf, composite, opaque, parseColour } from 'prism-term-core/renderer/lib/colour'
import {
  acrylicLevel,
  cleanDraft,
  cleanPresets,
  derive,
  folderIconOf,
  isStylesOwn,
  levelFor,
  mix,
  paintedAlpha,
  primaryValue,
  PRIMARY_ALPHA_MAX,
  PRIMARY_ALPHA_MIN,
  secondaryValue,
  sideOf,
  snapPrimaryAlpha,
  STYLES,
  variablesFor,
  type Style
} from './theme'

// ONE COLOUR PICKER, WITH ALPHA, ON THE STYLE PAGE (#249 rework; owner,
// 2026-10-03: "an input field for a color code and an alpha per colour on
// every colour setting colour picker both in pt and prism"). Decisions of the
// same day: Primary's alpha replaces the Acrylic slider under the slider's own
// rule, saved levels mapping 1:1 (1); Secondary has an alpha of its own that
// follows Primary's until moved (2); a text-bearing fill under glass is
// flattened so its label keeps 4.5:1 (5).

const lum = (hex: string): number => {
  const n = parseInt(hex.slice(1, 7), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const byte = (a: number): number => Math.round(a * 255)
const aurora = STYLES.find((s) => s.id === 'aurora')!
const glassy: Style = { ...aurora, material: 'acrylic', glass: 0.55 }
/** The glass the old slider wrote for a level: its own formula. */
const glassAt = (level: number): number => 0.85 - (level / 100) * 0.55

describe('colour maths reads eight digits', () => {
  it('the alpha digits never leak into the colour', () => {
    expect(mix('#ff000080', '#000000', 0)).toBe('#ff0000')
    expect(mix('#11223344', '#11223344', 0.5)).toBe('#112233')
  })
  it('a colour put back is judged on the colour, not the spelling', () => {
    expect(isStylesOwn(aurora, 'bg', aurora.bg.toUpperCase() + 'FF')).toBe(true)
    expect(isStylesOwn(aurora, 'text', aurora.text + '80')).toBe(false)
  })
})

describe("Primary's alpha is the Acrylic slider's level (decision 1)", () => {
  it('a solid style is opaque, and its value is six digits', () => {
    expect(primaryValue(aurora)).toBe(aurora.bg.toLowerCase())
    expect(levelFor(1)).toBe(0)
  })
  it("every saved level shows the alpha it paints, and maps back to the same paint", () => {
    for (let level = 1; level <= 100; level += 1) {
      const s: Style = { ...aurora, material: 'acrylic', glass: glassAt(level) }
      const shown = alphaOf(primaryValue(s))
      expect(byte(shown), `level ${level}`).toBe(byte(paintedAlpha(s)))
      const back: Style = { ...aurora, material: 'acrylic', glass: glassAt(levelFor(shown)) }
      expect(byte(paintedAlpha(back)), `level ${level}`).toBe(byte(paintedAlpha(s)))
      // Within the slider's own precision: the opaque end packs several
      // levels into one 1/255 step, so the level itself may move a notch or two.
      expect(Math.abs(levelFor(shown) - level), `level ${level}`).toBeLessThanOrEqual(2)
    }
  })
  it("the unrounded alpha maps back to the level exactly", () => {
    for (let level = 1; level <= 100; level += 1) {
      const s: Style = { ...aurora, material: 'acrylic', glass: glassAt(level) }
      expect(levelFor(paintedAlpha(s))).toBe(level)
    }
  })
  it("the range is the slider's two ends, and the top snaps to glass", () => {
    expect(PRIMARY_ALPHA_MIN).toBeCloseTo(0.5345, 3)
    expect(PRIMARY_ALPHA_MAX).toBeCloseTo(0.9507, 3)
    expect(snapPrimaryAlpha(1)).toBe(1)
    expect(snapPrimaryAlpha(0.98)).toBe(PRIMARY_ALPHA_MAX)
    expect(snapPrimaryAlpha(0.2)).toBe(PRIMARY_ALPHA_MIN)
    expect(snapPrimaryAlpha(0.7)).toBe(0.7)
    expect(levelFor(0.2)).toBe(100)
  })
  it("a style's default glass shows as the alpha it paints", () => {
    const s: Style = { ...aurora, material: 'acrylic' }
    delete s.glass
    expect(byte(alphaOf(primaryValue(s)))).toBe(byte(paintedAlpha(s)))
    expect(acrylicLevel(s)).toBe(Math.round(((0.85 - 0.55) / 0.55) * 100))
  })
})

describe('Secondary has an alpha of its own, following Primary until moved (decision 2)', () => {
  it("unset, it shows Primary's painted alpha", () => {
    expect(byte(alphaOf(secondaryValue(glassy)))).toBe(byte(paintedAlpha(glassy)))
    expect(secondaryValue(aurora)).toBe(sideOf(aurora).toLowerCase())
  })
  it('a chosen colour of six digits keeps following, eight digits are its own', () => {
    const follows: Style = { ...glassy, side: '#203040', sideOwn: true, title: '#203040', titleOwn: true }
    expect(byte(alphaOf(secondaryValue(follows)))).toBe(byte(paintedAlpha(glassy)))
    const own: Style = { ...follows, side: '#20304080', title: '#20304080', tabs: '#20304080', tabsOwn: true }
    expect(secondaryValue(own)).toBe('#20304080')
    const v = variablesFor(own)
    expect(v['--p-side']).toBe('rgba(32,48,64,0.502)')
    expect(v['--p-tabs']).toBe('rgba(32,48,64,0.502)')
    // The flat colour every contrast sum reads stays opaque.
    expect(v['--p-side-flat']).toBe('#203040')
    expect(sideOf(own)).toBe('#203040')
  })
  it('an own alpha of 100 on glass is a solid panel, not a follower', () => {
    const solidPanel: Style = { ...glassy, side: '#203040ff', sideOwn: true }
    expect(secondaryValue(solidPanel)).toBe('#203040')
    expect(variablesFor(solidPanel)['--p-side']).toBe('rgba(32,48,64,1)')
  })
})

describe('Text and Folder icons with an alpha are drawn composited and still read', () => {
  for (const s of STYLES) {
    it(`${s.id}`, () => {
      for (let a = 0.1; a < 1; a += 0.1) {
        const alpha = Math.round(a * 255).toString(16).padStart(2, '0')
        const text = opaque(s.text) + alpha
        const t = variablesFor({ ...s, text })
        const ink = t['--p-text']
        expect(parseColour(ink)!.a).toBe(1)
        const own = Math.min(contrast(opaque(s.text), sideOf(s)), contrast(opaque(s.text), s.bg))
        const floor = Math.min(4.5, own)
        expect(contrast(ink, sideOf(s)), `text ${alpha}`).toBeGreaterThanOrEqual(floor - 0.05)
        const folder = folderIconOf({ ...s, folderIcon: '#d9a53f' + alpha })
        expect(parseColour(folder)!.a).toBe(1)
        const fFloor = Math.min(3, contrast('#d9a53f', sideOf(s)))
        expect(contrast(folder, sideOf(s)), `folder ${alpha}`).toBeGreaterThanOrEqual(fFloor - 0.05)
      }
    })
  }
  it('an opaque text or folder colour is drawn exactly as picked', () => {
    for (const s of STYLES) {
      expect(variablesFor({ ...s, text: '#777777' })['--p-text']).toBe('#777777')
      expect(folderIconOf({ ...s, folderIcon: '#777777' })).toBe('#777777')
    }
  })
})

describe('a text-bearing fill under glass is flattened (decision 5)', () => {
  it('a see-through accent on a glass style paints opaque fills that still read', () => {
    for (const base of STYLES) {
      const s: Style = { ...base, material: 'acrylic', glass: 0.55, accentAlpha: 0.4 }
      const t = derive(s)
      for (const k of ['--p-accent', '--p-sel-bg']) {
        expect(t[k], `${base.id} ${k}`).toMatch(/^#[0-9a-f]{6}$/)
        expect(contrast(t['--p-on-accent'], t[k]), `${base.id} ${k}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(t['--p-sel-knockout-side']).toBe(t['--p-sel-bg'])
    }
  })
  it('over an opaque ground the fill stays see-through', () => {
    expect(derive({ ...aurora, accentAlpha: 0.4 })['--p-accent']).toMatch(/^#[0-9a-f]{8}$/)
  })
  it('an opaque accent under glass is untouched', () => {
    const t = derive({ ...glassy })
    expect(t['--p-accent']).toBe(derive({ ...aurora })['--p-accent'])
  })
  it('the flattened fill is the see-through one as it looked over the flat ground', () => {
    const open = derive({ ...aurora, accentAlpha: 0.4 })
    const flat = derive({ ...glassy, accentAlpha: 0.4 })
    expect(flat['--p-sel-bg']).toBe(composite(open['--p-sel-bg'], aurora.bg))
  })
})

describe('what is read from storage is cleaned', () => {
  it('a Primary of eight digits splits into the colour and the glass level', () => {
    const d = cleanDraft({ bg: '#10203080' })
    expect(d.bg).toBe('#102030')
    expect(d.acrylic).toBe(levelFor(0x80 / 255))
    // An acrylic level already in the draft wins over the colour's alpha.
    expect(cleanDraft({ bg: '#10203080', acrylic: 12 })).toEqual({ bg: '#102030', acrylic: 12 })
  })
  it('a colour that is not one is dropped, and a scheme accent is kept', () => {
    expect(cleanDraft({ text: 'nope', folderIcon: '#12', side: '#203040aa', accent: 'aurora' })).toEqual({
      side: '#203040aa',
      accent: 'aurora'
    })
  })
  it('an accent of eight digits splits into the colour and its alpha', () => {
    expect(cleanDraft({ accent: '#4682fb66' })).toEqual({ accent: '#4682fb', accentAlpha: 0.4 })
  })
  it('a saved preset with a broken colour is dropped, a broken optional colour forgotten', () => {
    const good = { ...aurora, id: 'custom-1', name: 'Custom theme 1', custom: true }
    const badBg = { ...good, id: 'custom-2', bg: 'zzz' }
    const badIcon = { ...good, id: 'custom-3', folderIcon: '#12345' }
    const glassBg = { ...good, id: 'custom-4', bg: '#10203080' }
    const out = cleanPresets([good, badBg, badIcon, glassBg, null, 'x'])
    expect(out.map((s) => s.id)).toEqual(['custom-1', 'custom-3', 'custom-4'])
    expect(out[1].folderIcon).toBeUndefined()
    expect(out[2].bg).toBe('#102030')
    expect(out[2].material).toBe('acrylic')
    expect(byte(paintedAlpha(out[2]))).toBe(byte(paintedAlpha({ ...aurora, material: 'acrylic', glass: glassAt(levelFor(0x80 / 255)) })))
    expect(cleanPresets('nope')).toEqual([])
  })
})

describe('the Style page writes through the store', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const draftNow = (): Record<string, unknown> => JSON.parse(localStorage.getItem('prism.style.draft') ?? '{}')

  it('a hue-only Primary edit leaves the material and the level alone', async () => {
    const theme = await import('./theme')
    const before = theme.currentStyle()
    theme.setPrimary('#203040')
    expect(draftNow()).toEqual({ bg: '#203040' })
    expect(theme.currentStyle().material).toBe(before.material)
  })
  it('a Primary alpha below 100 is the level the slider would write, and 100 is solid', async () => {
    const theme = await import('./theme')
    const bg = theme.currentStyle().bg
    theme.setPrimary(bg + '99')
    expect(draftNow()).toEqual({ acrylic: levelFor(0x99 / 255) })
    expect(theme.currentStyle().material).toBe('acrylic')
    theme.setPrimary(bg)
    // The level the style had (none: Aurora is solid) is no edit at all.
    expect(draftNow()).toEqual({})
    expect(theme.currentStyle().material).toBe('solid')
  })
  it('a mica style stays mica when its alpha moves', async () => {
    const mica: Style = { ...aurora, id: 'custom-mica', name: 'Mica', custom: true, material: 'mica', glass: 0.6 }
    localStorage.setItem('prism.style.presets', JSON.stringify([mica]))
    localStorage.setItem('prism.style', 'custom-mica')
    const theme = await import('./theme')
    theme.setPrimary(mica.bg + 'a0')
    expect(theme.currentStyle().material).toBe('mica')
    // The glass has a hundred levels, not 255 alphas: the nearest one paints.
    expect(Math.abs(byte(paintedAlpha(theme.currentStyle())) - 0xa0)).toBeLessThanOrEqual(1)
    theme.setPrimary(mica.bg)
    expect(theme.currentStyle().material).toBe('solid')
  })
  it('a hue-only Secondary edit stores six digits; moving its alpha stores eight', async () => {
    const theme = await import('./theme')
    theme.setPrimary(theme.currentStyle().bg + '99')
    const painted = alphaOf(theme.secondaryValue(theme.currentStyle()))
    const hex = (a: number): string => byte(a).toString(16).padStart(2, '0')
    theme.setSecondary('#203040' + hex(painted))
    expect(draftNow().side).toBe('#203040')
    theme.setSecondary('#20304080')
    expect(draftNow().side).toBe('#20304080')
    // Its own alpha stays its own through a hue edit.
    theme.setSecondary('#40302080')
    expect(draftNow().side).toBe('#40302080')
  })
  it('the accent: a colour edit keeps the alpha, an alpha edit keeps a scheme', async () => {
    const theme = await import('./theme')
    const scheme = theme.currentStyle().accent
    const hex = theme.paletteOf(scheme)[0]
    theme.setAccentColour(hex + '66')
    expect(draftNow()).toEqual({ accentAlpha: 0.4 })
    expect(theme.currentStyle().accent).toBe(scheme)
    theme.setAccentColour('#ff000066')
    expect(draftNow()).toEqual({ accentAlpha: 0.4, accent: '#ff0000' })
  })
  it('a row put back restores exactly what it had, none included', async () => {
    const theme = await import('./theme')
    const snapshot = { ...theme.overridesNow() }
    theme.setPrimary('#203040aa')
    theme.restoreOverrides(snapshot, ['bg', 'acrylic'])
    expect(draftNow()).toEqual({})
    expect(theme.isEdited()).toBe(false)
  })
})
