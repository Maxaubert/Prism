import { describe, expect, it } from 'vitest'
import { asksBeforeClosingTab, closeQuestionTitle, holdsWindowClose } from './agentClose'

describe('the close question', () => {
  it('never asks about a plain shell, and asks whenever a tab hosts an agent', () => {
    expect(asksBeforeClosingTab(false)).toBe(false)
    expect(asksBeforeClosingTab(true)).toBe(true)
  })
  it('holds the window only while an agent is mid-answer', () => {
    expect(holdsWindowClose(0)).toBe(false)
    expect(holdsWindowClose(2)).toBe(true)
  })
  it('says what it is about to interrupt', () => {
    expect(closeQuestionTitle('tab', null)).toMatch(/end the agent/)
    expect(closeQuestionTitle('tab', 90_000)).toMatch(/Stop the agent/)
    expect(closeQuestionTitle('window', 90_000)).toMatch(/window/)
    // An install quits the app, so it asks the window's question in its own words.
    expect(closeQuestionTitle('install', 90_000)).toMatch(/Stop the agent and install/)
    expect(closeQuestionTitle('install', 90_000)).not.toMatch(/window/)
  })
})
