import { describe, expect, it } from 'vitest'
import type { AgentIndicator } from '../host'
import { resolveTabMark, type MarkState, type MarkTabStyle } from './tabMark'

const m = (
  indicator: AgentIndicator,
  tabStyle: MarkTabStyle,
  state: MarkState | null,
  active: boolean,
  rainbow = true
): string => {
  const r = resolveTabMark({ indicator, tabStyle, state, active, rainbow })
  return `${r.place}/${r.colour ?? '-'}/${r.motion ?? '-'}${r.overlay ? '+' + r.overlay : ''}`
}

// One line per cell of the spec's section 3 table.
describe('which mark a tab wears (#143)', () => {
  it('Minimal, flat', () => {
    for (const on of [false, true]) {
      expect(m('minimal', 'flat', 'working', on)).toBe('run/working/run')
      expect(m('minimal', 'flat', 'done', on)).toBe('line/rainbow/flow')
      expect(m('minimal', 'flat', 'question', on)).toBe('line/question/breathe')
      expect(m('minimal', 'flat', 'failed', on)).toBe('line/failed/still')
    }
  })

  it('Minimal, Prompt: the edge, and the tab in front grows in the rule colour', () => {
    expect(m('minimal', 'prompt', 'working', false)).toBe('edge/working/grow')
    expect(m('minimal', 'prompt', 'working', true)).toBe('edge/rule/grow')
    for (const on of [false, true]) {
      expect(m('minimal', 'prompt', 'done', on)).toBe('edge/rainbow/flow')
      expect(m('minimal', 'prompt', 'question', on)).toBe('edge/question/breathe')
      expect(m('minimal', 'prompt', 'failed', on)).toBe('edge/failed/still')
    }
  })

  it('Ring: the spinner while working, in front or not, in either style; else Minimal', () => {
    for (const s of ['flat', 'prompt'] as const)
      for (const on of [false, true]) {
        expect(m('ring', s, 'working', on)).toBe('ring/working/spin')
        expect(m('ring', s, 'question', on)).toBe(m('minimal', s, 'question', on))
        expect(m('ring', s, 'done', on)).toBe(m('minimal', s, 'done', on))
        expect(m('ring', s, 'failed', on)).toBe(m('minimal', s, 'failed', on))
      }
  })

  // The 2026-10-10 rework (owner: "I really liked the new full style look"):
  // working is the fill with Minimal's own working mark on top (the run on
  // Classic; on Powerline the fill alone, owner: the pulsing arrow is only for
  // the tab you are on), finished the rainbow over the whole
  // tab, flowing. No badge, no ride.
  it('Full fills every marked tab NOT in front, in either style', () => {
    expect(m('full', 'flat', 'working', false)).toBe('fill/working/-+run')
    expect(m('full', 'prompt', 'working', false)).toBe('fill/working/-')
    for (const s of ['flat', 'prompt'] as const) {
      expect(m('full', s, 'done', false)).toBe('fill/rainbow/flow')
      expect(m('full', s, 'question', false)).toBe('fill/question/breathe')
      expect(m('full', s, 'failed', false)).toBe('fill/failed/still')
    }
  })

  it('Full never fills the tab in front: it shows Minimal\'s mark', () => {
    for (const s of ['flat', 'prompt'] as const)
      for (const st of ['working', 'done', 'question', 'failed'] as const)
        expect(m('full', s, st, true)).toBe(m('minimal', s, st, true))
  })

  it('Off: no working mark, the attention marks as Minimal', () => {
    for (const s of ['flat', 'prompt'] as const)
      for (const on of [false, true]) {
        expect(m('off', s, 'working', on)).toBe('none/-/-')
        for (const st of ['done', 'question', 'failed'] as const) expect(m('off', s, st, on)).toBe(m('minimal', s, st, on))
      }
  })

  it('with the rainbow off, finished is the finished colour, still, filled or not', () => {
    expect(m('minimal', 'flat', 'done', false, false)).toBe('line/done/still')
    expect(m('minimal', 'prompt', 'done', false, false)).toBe('edge/done/still')
    expect(m('full', 'flat', 'done', false, false)).toBe('fill/done/still')
    expect(m('full', 'prompt', 'done', true, false)).toBe('edge/done/still')
  })

  it('a tab with no state wears nothing, in every style', () => {
    for (const ind of ['off', 'minimal', 'ring', 'full'] as const)
      for (const s of ['flat', 'prompt'] as const)
        for (const on of [false, true]) expect(m(ind, s, null, on)).toBe('none/-/-')
  })
})
