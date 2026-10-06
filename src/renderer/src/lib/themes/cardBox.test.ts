import { describe, expect, it } from 'vitest'
import { contrastOf } from '../fieldColours'
import { STYLES } from '../theme'
import { miniLook } from './miniLook'
import { CARD_BOX, CARD_BOX_HI, CARD_TEXT, cardCheck } from './cardBox'

describe('the theme card box', () => {
  it('names a theme at 4.5:1 on the grey band', () => {
    expect(contrastOf(CARD_TEXT, CARD_BOX)).toBeGreaterThanOrEqual(4.5)
  })
  it('the hovered frame is a visible step off the resting one', () => {
    expect(contrastOf(CARD_BOX_HI, CARD_BOX)).toBeGreaterThanOrEqual(1.5)
  })
  it('every theme check reads 3:1 on the band', () => {
    for (const st of STYLES) expect(contrastOf(cardCheck(miniLook(st).accent), CARD_BOX), st.id).toBeGreaterThanOrEqual(3)
  })
  it('the box stands off a white page at 3:1 and off a black one', () => {
    expect(contrastOf(CARD_BOX, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrastOf(CARD_BOX, '#000000')).toBeGreaterThanOrEqual(1.3)
  })
})
