import { describe, expect, it } from 'vitest'
import { fold, searchSettings, type SettingsIndexEntry } from './search'

const e = (id: string, label: string, sub = '', extra: Partial<SettingsIndexEntry> = {}): SettingsIndexEntry => ({
  id,
  page: 'appearance',
  section: 'Theme',
  label,
  sub,
  icon: 'brush',
  ...extra
})

const INDEX = [
  e('term-theme', 'Terminal theme', 'Colours of the terminal and the window.', { keywords: 'palette scheme' }),
  e('window-background', 'Background colour', 'Behind the text in window and terminal.'),
  e('window-accent', 'Accent colour', 'Highlights, the active tab and selection.'),
  e('term-font', 'Terminal text size', 'Text size for every terminal.', { page: 'terminal', section: 'Text' }),
  e('agent-color', 'Agent working colour', 'Follows the accent.', { page: 'agents', section: 'Mark colours' }),
  e('dictation-language', 'Spoken language', 'The language you speak.', { page: 'dictation', section: 'Listening', keywords: 'norwegian' })
]
const ids = (q: string): string[] => searchSettings(INDEX, q, { appearance: 'Appearance', agents: 'Agents' }).map((r) => r.id)

describe('find a setting', () => {
  it('finds nothing for an empty or blank query', () => {
    expect(ids('')).toEqual([])
    expect(ids('   ')).toEqual([])
  })

  it('needs every word to match', () => {
    expect(ids('accent colour')).toEqual(['window-accent', 'agent-color'])
    expect(ids('accent spoken')).toEqual([])
  })

  it('matches the start of a word, not its middle', () => {
    expect(ids('col')).toContain('window-background')
    expect(ids('olour')).toEqual([])
  })

  it('folds case and accents', () => {
    expect(fold('Àccént')).toBe('accent')
    expect(ids('ACCÉNT')).toEqual(['window-accent', 'agent-color'])
  })

  it('puts a match in the label first, an exact label first of all', () => {
    // "terminal" is in the theme's label and in the background's subtext.
    expect(ids('terminal')).toEqual(['term-theme', 'term-font', 'window-background'])
    expect(ids('terminal text size')[0]).toBe('term-font')
    expect(ids('Agent working colour')[0]).toBe('agent-color')
  })

  it('reads the hidden keywords, the section and the page', () => {
    expect(ids('palette')).toEqual(['term-theme'])
    expect(ids('norwegian')).toEqual(['dictation-language'])
    expect(ids('mark colours')).toEqual(['agent-color'])
    expect(ids('agents')).toEqual(['agent-color'])
  })

  it('answers nothing found with an empty list', () => {
    expect(ids('zebra')).toEqual([])
  })
})
