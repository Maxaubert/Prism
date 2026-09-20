import { describe, expect, it } from 'vitest'
import { helpFront, helpShowing, helpStandsDown, isHelpKey } from './commandHelp'

const key = (over: Partial<Parameters<typeof isHelpKey>[0]> = {}): Parameters<typeof isHelpKey>[0] => ({
  key: 'F1',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...over
})

describe('the help key', () => {
  it('is a bare F1', () => {
    expect(isHelpKey(key())).toBe(true)
  })

  it('leaves every modified F1 to the shell', () => {
    expect(isHelpKey(key({ shiftKey: true }))).toBe(false)
    expect(isHelpKey(key({ ctrlKey: true }))).toBe(false)
    expect(isHelpKey(key({ altKey: true }))).toBe(false)
    expect(isHelpKey(key({ metaKey: true }))).toBe(false)
  })

  it('is no other key', () => {
    expect(isHelpKey(key({ key: 'F2' }))).toBe(false)
    expect(isHelpKey(key({ key: 'F11' }))).toBe(false)
  })
})

describe('when the popup stands down', () => {
  const front = helpFront('tab-1', 'term-1', false)
  const up = { enabled: true, showing: 'term-1', blocked: false, openedOver: front, front }

  it('stays while nothing has changed', () => {
    expect(helpStandsDown(up)).toBe(false)
  })

  it('goes with the terminal: Prism is a viewer first', () => {
    expect(helpStandsDown({ ...up, showing: null })).toBe(true)
  })

  it('goes when a question, the update window or the setup appears', () => {
    expect(helpStandsDown({ ...up, blocked: true })).toBe(true)
  })

  it('goes when the setting is switched off', () => {
    expect(helpStandsDown({ ...up, enabled: false })).toBe(true)
  })

  it('goes when something else comes to the front', () => {
    expect(helpStandsDown({ ...up, front: helpFront('tab-2', 'term-2', false) })).toBe(true)
    expect(helpStandsDown({ ...up, front: helpFront('tab-1', 'term-1', true) })).toBe(true)
    expect(helpStandsDown({ ...up, front: helpFront('tab-1', 'term-9', false) })).toBe(true)
  })
})

describe('which shell is showing', () => {
  it('is the dock while it is drawn, full or split', () => {
    expect(helpShowing({ fullscreen: false, dock: { id: 't1', view: 'full' }, paneTerms: [] })).toBe('t1')
    expect(helpShowing({ fullscreen: false, dock: { id: 't1', view: 'split' }, paneTerms: ['t2'] })).toBe('t1')
  })

  it('is a shell pinned as a pane when the dock is hidden: F1 is not dead there', () => {
    expect(helpShowing({ fullscreen: false, dock: { id: 't1', view: 'hidden' }, paneTerms: ['t1'] })).toBe('t1')
    expect(helpShowing({ fullscreen: false, dock: null, paneTerms: ['t2', 't3'] })).toBe('t2')
  })

  it('is nothing with no shell on screen: Prism is a viewer first', () => {
    expect(helpShowing({ fullscreen: false, dock: null, paneTerms: [] })).toBeNull()
    expect(helpShowing({ fullscreen: false, dock: { id: 't1', view: 'hidden' }, paneTerms: [] })).toBeNull()
  })

  it('is nothing in fullscreen, where no terminal is drawn', () => {
    expect(helpShowing({ fullscreen: true, dock: { id: 't1', view: 'full' }, paneTerms: ['t2'] })).toBeNull()
  })
})
