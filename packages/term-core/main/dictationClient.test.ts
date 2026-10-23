import { describe, expect, it } from 'vitest'
import { dictationAnswers, publishTabs, typeChecked } from './dictationClient'
import type { SendDecision, SendTab } from './orchestratorSend'

/**
 * Joining the one dictation from any app (2026-10-17): the checks of typing
 * into a tab, which every app keeps (the rule 2 exception: a running Claude
 * only, decided again before typing and before Enter).
 */

const tab = (over: Partial<SendTab> = {}): SendTab => ({
  id: 'p1',
  tab: 't1',
  label: 'Wind',
  cwd: 'C:\\src\\wind',
  agent: 'claude',
  state: null,
  orchestrator: false,
  session: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ...over
})
const ok = (t: SendTab): SendDecision => ({ ok: true, target: t })

function host(under: string | null = 'claude') {
  const written: string[] = []
  const later: Array<() => void> = []
  return {
    written,
    runLater: () => later.splice(0).forEach((f) => f()),
    deps: { agentUnder: async () => under, writeTerm: (_id: string, data: string) => void written.push(data) },
    later: (f: () => void) => void later.push(f)
  }
}

describe('typeChecked', () => {
  it('pastes, then presses Enter only if the tab can still take it', async () => {
    const h = host()
    const r = await typeChecked(() => ok(tab()), 'hello', h.deps, h.later)
    expect(r.ok).toBe(true)
    expect(h.written).toEqual(['\x1b[200~hello\x1b[201~'])
    h.runLater()
    expect(h.written).toEqual(['\x1b[200~hello\x1b[201~', '\r'])
  })
  it('types nothing where Windows says no Claude runs', async () => {
    const h = host('pwsh')
    const r = await typeChecked(() => ok(tab()), 'hello', h.deps, h.later)
    expect(r).toEqual({ ok: false, reason: 'no Claude is running in Wind (checked with Windows)' })
    expect(h.written).toEqual([])
  })
  it('types nothing when the tab changed while Windows was asked', async () => {
    const h = host()
    let n = 0
    const r = await typeChecked(() => ok(tab({ session: n++ === 0 ? 'one' : 'two' })), 'hello', h.deps, h.later)
    expect(r.ok).toBe(false)
    expect(h.written).toEqual([])
  })
  it('holds the Enter back when a question opened before it', async () => {
    const h = host()
    let asking = false
    const r = await typeChecked(() => (asking ? { ok: false, reason: 'asking' } : ok(tab())), 'hello', h.deps, h.later)
    expect(r.ok).toBe(true)
    asking = true
    h.runLater()
    expect(h.written).toEqual(['\x1b[200~hello\x1b[201~'])
  })
})

describe('publishTabs', () => {
  it('marks the orchestrator only when it is switched on and its Claude runs', async () => {
    const tabs = [tab({ orchestrator: true }), tab({ id: 'p2' })]
    expect((await publishTabs(tabs, true, async () => 'claude')).map((t) => t.orchestrator)).toEqual([true, false])
    expect((await publishTabs(tabs, false, async () => 'claude')).map((t) => t.orchestrator)).toEqual([false, false])
    expect((await publishTabs(tabs, true, async () => null)).map((t) => t.orchestrator)).toEqual([false, false])
  })
})

describe('dictationAnswers', () => {
  it('answers with the tabs, sends checked, and pastes through the host', async () => {
    const pasted: string[] = []
    const written: string[] = []
    const a = dictationAnswers({
      tabs: () => [tab()],
      orchestratorOn: () => false,
      agentUnder: async () => 'claude',
      writeTerm: (_id, d) => void written.push(d),
      paste: (t) => void pasted.push(t)
    })
    expect(await a.tabs()).toEqual([tab()])
    expect((await a.send('p1', 'hi')).ok).toBe(true)
    expect(written[0]).toBe('\x1b[200~hi\x1b[201~')
    expect((await a.send('nope', 'hi')).ok).toBe(false)
    a.paste('typed')
    expect(pasted).toEqual(['typed'])
  })
})
