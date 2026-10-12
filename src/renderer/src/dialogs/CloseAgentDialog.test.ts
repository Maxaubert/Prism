import { describe, expect, it, vi } from 'vitest'
import { CloseAgentDialog } from './CloseAgentDialog'
import { labels, pick, specOf, type DialogSpec } from './testing'

type Props = Parameters<typeof CloseAgentDialog>[0]
const spec = (p: Partial<Props>): DialogSpec =>
  specOf(
    CloseAgentDialog({
      target: 'tab',
      label: 'Prism',
      agent: { kind: 'claude', forMs: null },
      onCancel: () => {},
      onClose: () => {},
      ...p
    })
  )

describe('CloseAgentDialog', () => {
  it('an idle agent in a tab', () => {
    const s = spec({})
    expect(s.text).toBe(
      'Claude is running in Prism. Closing the tab kills the shell, and the session with it.'
    )
    expect(labels(s)).toEqual(['Cancel', 'Close tab'])
  })

  it('a working agent names how long, and the window counts the others', () => {
    const s = spec({ target: 'window', agent: { kind: 'codex', forMs: 120_000 }, others: 2 })
    expect(s.text).toMatch(
      /^Codex has been working for .+ in Prism, and 2 other shells are working too\. Closing kills the shell, and the answer with it\.$/
    )
    expect(labels(s)).toEqual(['Cancel', 'Close window'])
  })

  it('a tab never counts others', () => {
    expect(spec({ agent: { kind: 'other', forMs: 5000 }, others: 3 }).text).not.toContain('other shell')
  })

  it('an install says it restarts', () => {
    const onClose = vi.fn()
    const s = spec({ target: 'install', agent: { kind: 'claude', forMs: 1000 }, others: 1, onClose })
    expect(s.text).toContain(', and 1 other shell is working too.')
    expect(s.text).toContain('Installing restarts Prism, which kills the shell, and the answer with it.')
    expect(labels(s)).toEqual(['Cancel', 'Install and restart'])
    expect(pick(s, 'Install and restart').primary).toBe(true)
    pick(s, 'Install and restart').onPick()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
