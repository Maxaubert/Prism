import { describe, expect, it } from 'vitest'
import { contrastOf, controlFieldOn, hintOn, isNearBlack, nearBlackField } from './fieldColours'
import { STYLES, variablesFor } from './theme'

const byId = (id: string) => STYLES.find((s) => s.id === id)!

describe('the toolbar fields (#267)', () => {
  it('near-black is measured from the ground, not the name', () => {
    expect(isNearBlack('#000000')).toBe(true)
    expect(isNearBlack('#0d0d0d')).toBe(true)
    expect(isNearBlack('#0b0f14')).toBe(true)
    // Driftwood's brown and anything lighter keep their own field.
    expect(isNearBlack('#1b1510')).toBe(false)
    expect(isNearBlack('#fbfbfc')).toBe(false)
  })

  it('on black the fill is darker than the old control step, and the edge carries the shape', () => {
    const f = nearBlackField('#000000', '#e8eaf0')!
    expect(f.fill).toBe('#060606')
    // The old control fill on Void was #080808.
    expect(contrastOf(f.fill, '#000000')).toBeLessThan(contrastOf('#080808', '#000000'))
    expect(contrastOf(f.fill, '#000000')).toBeGreaterThan(1)
    // A quiet line, not a white frame (owner, 2026-10-04).
    expect(contrastOf(f.edge, '#000000')).toBeGreaterThanOrEqual(1.6)
    expect(contrastOf(f.edge, '#000000')).toBeLessThan(1.8)
    expect(contrastOf(f.edgeHover, '#000000')).toBeGreaterThan(contrastOf(f.edge, '#000000'))
  })

  it('anywhere else there is no near-black field', () => {
    expect(nearBlackField('#1b1510', '#ede4d8')).toBeNull()
    expect(nearBlackField('#fbfbfc', '#1b1d21')).toBeNull()
  })

  it('a hint is moved only as far as 4.5:1 on its field', () => {
    expect(hintOn('#909195', '#e8eaf0', '#060606')).toBe('#909195')
    const h = hintOn('#707174', '#1b1d21', '#e7e7e8')
    expect(contrastOf(h, '#e7e7e8')).toBeGreaterThanOrEqual(4.5)
    expect(contrastOf('#707174', '#e7e7e8')).toBeLessThan(4.5)
  })

  it('Void wears the dark field; Paper the control step; both off the row (#306)', () => {
    const v = variablesFor(byId('new-void'))
    const vRow = v['--p-side-flat']
    expect(vRow).toBe('#000000')
    expect(v['--p-field']).toBe(nearBlackField('#000000', '#e8eaf0', vRow)!.fill)
    expect(contrastOf(v['--p-field-edge'], vRow)).toBeGreaterThanOrEqual(1.6)
    expect(contrastOf(v['--p-field-edge'], vRow)).toBeLessThan(1.8)
    const p = variablesFor(byId('paper'))
    expect(p['--p-field']).toBe(controlFieldOn(p['--p-side-flat'], '#1b1d21', true))
    expect(p['--p-field-edge']).toBe(p['--p-divider'])
  })

  it('a near-black style is judged by its page, its field coloured off the row', () => {
    // Aurora's page is near-black, its sidebar (#121419) is not: it keeps
    // the quiet field, stepped off the sidebar.
    const f = nearBlackField('#0b0d12', '#e8eaf0', '#121419')!
    expect(f).not.toBeNull()
    expect(contrastOf(f.fill, '#121419')).toBeGreaterThan(1.02)
    expect(contrastOf(f.edge, '#121419')).toBeGreaterThanOrEqual(1.6)
  })

  it('every shipped style: the address field stands off the row it sits on (#306)', () => {
    // MEASURED before: 1.01:1 on every dark style, the fill a step off the
    // page and the row a step off it the other way.
    for (const s of STYLES) {
      const v = variablesFor(s, true)
      expect(contrastOf(v['--p-field'], v['--p-side-flat']), s.id).toBeGreaterThan(1.03)
    }
  })

  it('every shipped style: the field text and hint read on the field', () => {
    for (const s of STYLES) {
      const v = variablesFor(s, true)
      expect(contrastOf(v['--p-field-hint'], v['--p-field']), s.id).toBeGreaterThanOrEqual(4.5)
      expect(contrastOf(v['--p-text-soft'], v['--p-field']), s.id).toBeGreaterThanOrEqual(4.5)
    }
  })
})
