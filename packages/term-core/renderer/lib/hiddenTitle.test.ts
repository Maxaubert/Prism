import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hiddenTitle, isClipped, textHidden, type TitleTarget } from './hiddenTitle'

/** A stand-in element; `had` says whether it still carries a title at all. */
const el = (over: Partial<TitleTarget> = {}): TitleTarget & { had: boolean } => ({
  scrollWidth: 100,
  clientWidth: 100,
  innerText: 'Appearance',
  title: 'stale',
  had: true,
  removeAttribute(this: TitleTarget & { had: boolean }) {
    this.title = ''
    this.had = false
  },
  ...over
})
const hover = (target: TitleTarget, text: string | undefined): string => {
  hiddenTitle(text).onMouseEnter({ currentTarget: target })
  return target.title
}

describe('a tooltip says only what the eye cannot read (owner, 2026-10-12)', () => {
  it('no tooltip when the words are all on screen', () => {
    expect(textHidden(el(), 'Appearance')).toBe(false)
    expect(hover(el(), 'Appearance')).toBe('')
  })
  it('the whole text when an ellipsis cut it', () => {
    expect(hover(el({ scrollWidth: 180 }), 'Appearance')).toBe('Appearance')
  })
  it('the name when the layout hid it: the folded settings rail', () => {
    expect(hover(el({ innerText: '' }), 'Appearance')).toBe('Appearance')
  })
})

// The app's own copy, merged in (2026-10-28): Explorer rows, crumbs and the
// properties panel use this one now.
describe('what the app copy brought with it', () => {
  it('takes the attribute away, not just its words, once the text fits', () => {
    const target = el({ scrollWidth: 180 })
    hover(target, 'Appearance')
    expect(target.had).toBe(true)
    target.clientWidth = 200
    hover(target, 'Appearance')
    expect(target.had).toBe(false)
  })
  it('half a pixel of rounding is not a cut', () => {
    expect(isClipped({ scrollWidth: 200.4, clientWidth: 200 })).toBe(false)
    expect(isClipped({ scrollWidth: 201, clientWidth: 200 })).toBe(true)
  })
  it('an absent or empty text gives no tooltip, however cut', () => {
    expect(el({ scrollWidth: 300 }).had).toBe(true)
    const a = el({ scrollWidth: 300 })
    hover(a, undefined)
    expect(a.had).toBe(false)
    const b = el({ scrollWidth: 300 })
    hover(b, '')
    expect(b.had).toBe(false)
  })
  it('a name with a run of spaces is not taken for hidden: innerText folds them', () => {
    expect(hover(el({ innerText: 'two spaces.txt' }), 'two  spaces.txt')).toBe('')
  })
})

describe('labels that repeat themselves', () => {
  const read = (p: string): string => readFileSync(join(__dirname, p), 'utf8')
  it.each([
    ['../settings/layout/SettingsFrame.tsx', /title=\{p\.label\}/],
    ['../settings/layout/SettingRow.tsx', /title=\{text\}/]
  ])('%s puts no fixed tooltip on its own visible text', (file, bare) => {
    expect(read(file)).not.toMatch(bare)
  })
})
