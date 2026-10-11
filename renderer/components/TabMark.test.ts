import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { resolveTabMark, type MarkState } from '../lib/tabMark'
import { TabMark } from './TabMark'

const draw = (
  indicator: 'minimal' | 'ring' | 'full',
  state: MarkState,
  extra: { active?: boolean; overlay?: string; ink?: string } = {}
): string =>
  renderToStaticMarkup(
    createElement(TabMark, {
      mark: resolveTabMark({ indicator, tabStyle: 'flat', state, active: !!extra.active, rainbow: true }),
      state,
      background: '#123456',
      overlay: extra.overlay,
      ink: extra.ink
    })
  )

describe('the flat tab mark (#143)', () => {
  it('draws the running bar while working, hidden from the reader', () => {
    const html = draw('minimal', 'working')
    expect(html).toContain('data-mark="run"')
    expect(html).toContain('p-agent-run')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('data-attention')
  })

  it('draws a 3 px line for a question, breathing, with its attention kept for the e2e', () => {
    const html = draw('minimal', 'question')
    expect(html).toContain('data-mark="line"')
    expect(html).toContain('data-attention="question"')
    expect(html).toContain('p-mark-breathe')
    expect(html).toContain('h-[3px]')
  })

  it('flows the rainbow on a finished line and says so', () => {
    const html = draw('minimal', 'done')
    expect(html).toContain('data-rainbow=""')
    expect(html).toContain('p-mark-flow-x')
    expect(html).toContain('data-attention="done"')
  })

  it('spins a ring for Ring while working', () => {
    const html = draw('ring', 'working')
    expect(html).toContain('data-mark="ring"')
    expect(html).toContain('p-mark-spin')
  })

  it('fills a Full tab not in front, the name ink a CSS variable, not per frame', () => {
    const q = draw('full', 'question', { ink: '#eeeeee' })
    expect(q).toContain('data-mark="fill"')
    expect(q).toContain('p-mark-breathe')
    expect(q).toContain('--mark-ink:#eeeeee')
  })

  // Owner, 2026-10-10: on a working fill the Minimal bar is the NAME'S ink
  // (black on Volt's yellow), never a faded shade of the working colour.
  it('runs Minimal\'s bar over a working fill, in the colour it is given', () => {
    const html = draw('full', 'working', { ink: '#0b0b0b', overlay: '#0b0b0b' })
    expect(html).toContain('data-mark="fill"')
    expect(html).toContain('data-mark-overlay="run"')
    expect(html).toContain('p-agent-run')
    expect(html).toContain('background:#0b0b0b')
    expect(html).not.toContain('p-mark-ride')
  })

  it('flows the rainbow over a whole finished fill, no badge, no foot', () => {
    const html = draw('full', 'done')
    expect(html).toContain('data-mark="fill"')
    expect(html).toContain('data-rainbow=""')
    expect(html).toContain('p-mark-flow-fill')
    expect(html).not.toContain('data-mark-foot')
  })

  it('draws nothing for a Full tab in front beyond Minimal\'s mark', () => {
    expect(draw('full', 'working', { active: true })).toContain('data-mark="run"')
  })
})
