import { describe, expect, it } from 'vitest'
import { contrastOf, hintOn, isNearBlack, nearBlackField } from './fieldColours'
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
    expect(contrastOf(f.edge, '#000000')).toBeGreaterThanOrEqual(3)
    // The quietest edge that does it, not a white outline.
    expect(contrastOf(f.edge, '#000000')).toBeLessThan(3.3)
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

  it('Void wears the dark field; Paper keeps the fill it had', () => {
    const v = variablesFor(byId('new-void'))
    expect(v['--p-field']).toBe('#060606')
    expect(contrastOf(v['--p-field-edge'], '#000000')).toBeGreaterThanOrEqual(3)
    const p = variablesFor(byId('paper'))
    expect(p['--p-field']).toBe(p['--p-control'])
    expect(p['--p-field']).toBe('#e7e7e8')
    expect(p['--p-field-edge']).toBe(p['--p-divider'])
  })

  it('every shipped style: the field text and hint read on the field', () => {
    for (const s of STYLES) {
      const v = variablesFor(s, true)
      expect(contrastOf(v['--p-field-hint'], v['--p-field']), s.id).toBeGreaterThanOrEqual(4.5)
      expect(contrastOf(v['--p-text-soft'], v['--p-field']), s.id).toBeGreaterThanOrEqual(4.5)
    }
  })
})
