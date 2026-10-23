import { describe, expect, it } from 'vitest'
import { decideSend, pasteOf, SEND_MAX, type SendTab } from './orchestratorSend'

/**
 * The orchestrator's sends (owner, 2026-10-16: "to any session, not just
 * whichever is in focus"): only from the promoted tab, only into a running
 * Claude that is not asking, the target named any way the owner would.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tab = (over: Partial<SendTab>): SendTab => ({
  id: 'p1',
  tab: 'tok-1',
  label: 'Wind',
  cwd: 'C:\\src\\wind',
  agent: 'claude',
  state: null,
  orchestrator: false,
  session: A,
  ...over
})
const lead = tab({ id: 'p0', tab: 'tok-lead', label: 'Lead', cwd: 'C:\\src', orchestrator: true, session: null })
const tabs = [lead, tab({}), tab({ id: 'p2', tab: 'tok-2', label: 'web-application-project', cwd: 'C:\\src\\webapp', session: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })]
const ask = (to: string, text = 'fix the failing test', from = 'tok-lead') => decideSend({ from, to, text }, tabs, true)

describe('decideSend', () => {
  it('sends to a tab named by label, a word of it, its folder, its session or its PRISM_TAB_ID', () => {
    for (const to of ['Wind', 'wind', 'tok-1', A]) expect(ask(to)).toMatchObject({ ok: true, target: { id: 'p1' } })
    expect(ask('webapp')).toMatchObject({ ok: true, target: { id: 'p2' } })
    expect(ask('web-app')).toMatchObject({ ok: true, target: { id: 'p2' } })
  })

  it('works for any tab, whichever is in front', () => {
    // Nothing about the front tab is an input at all: the target is the name.
    expect(ask('web-application-project')).toMatchObject({ ok: true, target: { label: 'web-application-project' } })
  })

  it('asks for one when a name matches several, and says when it matches none', () => {
    expect(ask('src')).toEqual({ ok: false, reason: '"src" matches Wind, web-application-project: name one' })
    expect(ask('sonara')).toEqual({ ok: false, reason: 'no tab matches "sonara"' })
  })

  it('takes requests only from the promoted tab, and never sends to itself', () => {
    expect(ask('Wind', 'x', 'tok-1')).toEqual({ ok: false, reason: 'only the orchestrator tab can send' })
    expect(ask('Lead')).toEqual({ ok: false, reason: 'no tab matches "Lead"' })
    expect(decideSend({ from: 'tok-lead', to: 'Wind', text: 'x' }, tabs.map((t) => ({ ...t, orchestrator: false })), true)).toMatchObject({ ok: false })
    expect(decideSend({ from: 'tok-lead', to: 'Wind', text: 'x' }, tabs, false)).toEqual({ ok: false, reason: 'the orchestrator is switched off in Settings' })
  })

  // Rule 2's exception is a Claude Code prompt and nothing else: a shell would
  // run the text, and a question box would take it as its answer.
  it('never types into a shell or into a question', () => {
    const shell = [lead, tab({ agent: null, session: null })]
    expect(decideSend({ from: 'tok-lead', to: 'Wind', text: 'x' }, shell, true)).toEqual({ ok: false, reason: 'Wind has no Claude session running' })
    const asking = [lead, tab({ state: 'question' })]
    expect(decideSend({ from: 'tok-lead', to: 'Wind', text: 'x' }, asking, true)).toEqual({ ok: false, reason: 'Wind is waiting on a question: answer it there first' })
    const working = [lead, tab({ state: 'working' })]
    expect(decideSend({ from: 'tok-lead', to: 'Wind', text: 'x' }, working, true)).toMatchObject({ ok: true })
  })

  it('refuses an empty or an oversized message', () => {
    expect(ask('Wind', '   ')).toEqual({ ok: false, reason: 'the message is empty' })
    expect(ask('Wind', 'x'.repeat(SEND_MAX + 1))).toMatchObject({ ok: false })
  })
})

describe('pasteOf', () => {
  // Rule 1: the message cannot end its own paste or carry a key.
  it('frames the message as one paste with every escape and control taken out', () => {
    expect(pasteOf('fix it\r\nthen test\u001b[201~\u0003 done')).toBe('\u001b[200~fix it\nthen test[201~ done\u001b[201~')
  })
})
