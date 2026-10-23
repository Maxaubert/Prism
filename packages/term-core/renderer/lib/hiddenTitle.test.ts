import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hiddenTitle, textHidden, type TitleTarget } from './hiddenTitle'

const el = (over: Partial<TitleTarget> = {}): TitleTarget => ({
  scrollWidth: 100,
  clientWidth: 100,
  innerText: 'Appearance',
  title: 'stale',
  ...over
})
const hover = (target: TitleTarget, text: string): string => {
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

describe('labels that repeat themselves', () => {
  const read = (p: string): string => readFileSync(join(__dirname, p), 'utf8')
  it.each([
    ['../settings/layout/SettingsFrame.tsx', /title=\{p\.label\}/],
    ['../settings/layout/SettingRow.tsx', /title=\{text\}/],
    ['../components/HelpPanel.tsx', /title=\{row\.(name|command)\}/]
  ])('%s puts no fixed tooltip on its own visible text', (file, bare) => {
    expect(read(file)).not.toMatch(bare)
  })
})
