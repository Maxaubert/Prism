import { describe, expect, it } from 'vitest'
import { extractQuestion } from './questionWidget'
import screens from './questionWidget.screens.json'

// The screens are Claude Code 2.1.301's question widget as the probe of
// 2026-10-16 captured it (Sonara #323): 120 columns (run2) and 70 (run3).
const at = (name: string): string[] => (screens as Record<string, string[]>)[name]

describe('extractQuestion', () => {
  it('reads the question under the tab row', () => {
    expect(extractQuestion(at('run2-01-question-1'))).toEqual({ text: 'Pick a colour?' })
    expect(extractQuestion(at('run2-02-right'))).toEqual({ text: 'Pick a size?' })
  })

  it('moves on when an answer moves the widget on', () => {
    expect(extractQuestion(at('run2-07-enter-answer'))).toEqual({ text: 'Pick a shape?' })
  })

  it('joins a wrapped question with single spaces', () => {
    expect(extractQuestion(at('run3-01-question-1'))).toEqual({
      text:
        'When the installer finds the search service already running from an earlier version, should it stop the service, replace its files and start it again, or leave the running copy alone until the next reboot?'
    })
  })

  it('reads a multi-select question, ticked or not', () => {
    expect(extractQuestion(at('run3-02-right'))).toEqual({ text: 'Which platforms should the build cover?' })
    expect(extractQuestion(at('run3-03-space-on-windows'))).toEqual({
      text: 'Which platforms should the build cover?'
    })
  })

  it('keeps the question while an answer is typed', () => {
    expect(extractQuestion(at('run3-07-type'))).toEqual({ text: 'Name the release?' })
  })

  it('reports the review of the answers', () => {
    expect(extractQuestion(at('run2-08-enter-answer'))).toEqual({ review: true })
  })

  it('reads the last widget frame when a stale one stands above it', () => {
    expect(extractQuestion([...at('run2-01-question-1'), ...at('run2-02-right')])).toEqual({ text: 'Pick a size?' })
  })

  it('is null without the widget', () => {
    expect(extractQuestion(['PS C:\\> claude', '', 'Some reply text.'])).toBeNull()
    expect(extractQuestion([])).toBeNull()
  })
})
