import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTermCore, resetTermCore, type TermHostConfig } from '../../host'
import { coreSettingsIndex } from '../coreIndex'
import { acrylicLabel, acrylicSub, opt, saveSetupTitle } from './opts'

// #156: where the terminal owns the window acrylic (Prism Terminal), the
// acrylic row IS the see-through window and is worded as Prism words its own;
// in Prism it stays the terminal's row under the app's see-through.

const base = {
  api: {} as TermHostConfig['api'],
  themedAgentColors: () => ({ working: '#5b5bd6', finished: '#22c55e' }),
  ownsKey: () => false
}
const WINDOW: TermHostConfig = {
  ...base,
  defaults: { theme: 'prism', acrylic: false, indicator: 'minimal', agentColor: '', agentDoneColor: '' },
  followsHostStyle: false,
  paintsGround: true,
  acrylic: { kind: 'window', supported: async () => true }
}
const STYLE: TermHostConfig = {
  ...base,
  defaults: { theme: 'style', acrylic: true, indicator: 'full', agentColor: '#f97316', agentDoneColor: '#22c55e' },
  followsHostStyle: true,
  paintsGround: false,
  acrylic: { kind: 'style' }
}

describe('the acrylic row, per host (#156)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => resetTermCore())

  it("Prism Terminal: Prism's own name and words", () => {
    configureTermCore(WINDOW)
    expect(acrylicLabel()).toBe('See-through window')
    expect(acrylicSub()).toBe('The desktop shows behind every surface.')
  })
  it('Prism: the terminal row keeps its name and words', () => {
    configureTermCore(STYLE)
    expect(acrylicLabel()).toBe(opt('term-acrylic').label)
    expect(acrylicSub()).toBe('The desktop shows through the terminal.')
  })
  it('Find a setting words the row as the page does', () => {
    configureTermCore(WINDOW)
    const row = coreSettingsIndex({ pageOf: () => 'appearance', nvidia: false }).find((e) => e.id === 'term-acrylic')
    expect(row).toMatchObject({ label: 'See-through window', sub: 'The desktop shows behind every surface.' })
    // "see through" still finds it by its keywords in Prism's wording too.
    expect(row?.keywords).toContain('see through')
  })
  it('Save changes names the setting as the page does, per host', () => {
    configureTermCore(WINDOW)
    expect(saveSetupTitle()).toBe('Saves the theme, agent colours and see-through window as Custom')
    configureTermCore(STYLE)
    expect(saveSetupTitle()).toBe('Saves the theme, agent colours and acrylic as Custom')
  })
})