import { describe, expect, it } from 'vitest'
import screens from './agentBackground.screens.json'
import { looksLikeBackgroundWork } from './agentBackground'

describe('background work on Claude Code\'s screen (MEASURED 2026-10-16)', () => {
  it('a shell started in the background, while it runs', () => {
    expect(looksLikeBackgroundWork(screens.shellRunning)).toBe(true)
  })
  it('the same session once the shell has ended', () => {
    expect(looksLikeBackgroundWork(screens.shellDone)).toBe(false)
  })
  it('a workflow running, though the old "Waiting for" lines stay above', () => {
    expect(looksLikeBackgroundWork(screens.workflowRunning)).toBe(true)
  })
  it('the workflow finished: its stale "Waiting for" line alone is not work', () => {
    expect(looksLikeBackgroundWork(screens.workflowDone)).toBe(false)
  })
  it('a plain shell prompt or empty screen is not', () => {
    expect(looksLikeBackgroundWork([])).toBe(false)
    expect(looksLikeBackgroundWork(['PS C:\\work> npm test', '  12/40 passed · 3s'])).toBe(false)
  })
})
