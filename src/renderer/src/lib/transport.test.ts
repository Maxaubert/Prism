import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSPORT_BG,
  loadTransportBg,
  loadTransportStyle,
  TRANSPORT_BG_KEY,
  TRANSPORT_KEY
} from './transport'

beforeEach(() => localStorage.clear())

describe('the transport background', () => {
  it('starts opaque: the bar as it has always looked', () => {
    expect(DEFAULT_TRANSPORT_BG).toBe(100)
    expect(loadTransportBg()).toBe(100)
  })

  it('remembers where the slider was left', () => {
    localStorage.setItem(TRANSPORT_BG_KEY, '35')
    expect(loadTransportBg()).toBe(35)
  })

  it('keeps a deliberate zero, which is the whole point of the slider', () => {
    localStorage.setItem(TRANSPORT_BG_KEY, '0')
    expect(loadTransportBg()).toBe(0)
  })

  it('reads "never set" as opaque, not as transparent', () => {
    // Number(null) and Number('') are both 0: read naively, a fresh install
    // would lose its bar.
    localStorage.setItem(TRANSPORT_BG_KEY, '')
    expect(loadTransportBg()).toBe(100)
  })

  it('clamps nonsense rather than passing it to CSS', () => {
    localStorage.setItem(TRANSPORT_BG_KEY, '420')
    expect(loadTransportBg()).toBe(100)
    localStorage.setItem(TRANSPORT_BG_KEY, '-40')
    expect(loadTransportBg()).toBe(0)
    localStorage.setItem(TRANSPORT_BG_KEY, 'soup')
    expect(loadTransportBg()).toBe(100)
  })

  it('is its own setting: the style choice does not touch it', () => {
    localStorage.setItem(TRANSPORT_KEY, 'wave')
    expect(loadTransportStyle()).toBe('wave')
    expect(loadTransportBg()).toBe(100)
  })
})
