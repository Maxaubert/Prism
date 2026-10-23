import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTermCore, resetTermCore, type TermHostConfig } from '../../host'
import { coreSettingsIndex } from '../coreIndex'
import { acrylicSub, opt, saveSetupTitle } from './opts'

// The acrylic row is the terminal's own switch under the app's see-through
// window: it keeps its name and words.

const STYLE: TermHostConfig = {
  api: {} as TermHostConfig['api'],
  themedAgentColors: () => ({ working: '#5b5bd6', finished: '#22c55e' }),
  ownsKey: () => false,
  defaults: { theme: 'style', acrylic: true, indicator: 'full', agentColor: '#f97316', agentDoneColor: '#22c55e' },
  followsHostStyle: true,
  paintsGround: false,
  acrylic: { kind: 'style' }
}

describe('the acrylic row', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => resetTermCore())

  it('keeps its name and words', () => {
    configureTermCore(STYLE)
    expect(opt('term-acrylic').label).toBe('Acrylic terminal background')
    expect(acrylicSub()).toBe('The desktop shows through the terminal.')
  })
  it('Find a setting words the row as the page does', () => {
    configureTermCore(STYLE)
    const row = coreSettingsIndex({ pageOf: () => 'appearance', nvidia: false }).find((e) => e.id === 'term-acrylic')
    expect(row).toMatchObject({ label: opt('term-acrylic').label, sub: acrylicSub() })
    expect(row?.keywords).toContain('see through')
  })
  it('Save changes names the setting as the page does', () => {
    configureTermCore(STYLE)
    expect(saveSetupTitle()).toBe('Saves the theme, agent colours and acrylic as Custom')
  })
})