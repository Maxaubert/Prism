import { describe, expect, it } from 'vitest'
import { hookStep, raisedWhileSeen, screenDecides, type HookEvent, type HookPhase, type HookSession } from './agentHookState'

/** Run events through the rules from no state, as the indicator does. */
function run(events: HookEvent[]): { s: HookSession | undefined; last: ReturnType<typeof hookStep> } {
  let s: HookSession | undefined
  let last: ReturnType<typeof hookStep> = null
  for (const ev of events) {
    last = hookStep(s, ev)
    if (last) s = { phase: last.phase, kind: last.kind }
  }
  return { s, last }
}

describe('hookStep', () => {
  it('a prompt is work, and clears every mark', () => {
    const o = hookStep(undefined, { state: 'working' })
    expect(o).toMatchObject({ phase: 'working', working: true, raise: [] })
    expect(o?.clear.sort()).toEqual(['failed', 'finished', 'question'])
  })

  it('a Stop finishes: the Finished line, and no question or failure left', () => {
    const { last } = run([{ state: 'working' }, { state: 'done' }])
    expect(last).toMatchObject({ phase: 'done', working: false, raise: ['finished'] })
    expect(last?.clear.sort()).toEqual(['failed', 'question'])
  })

  it('a permission prompt or a question is the Question line, and not a finish', () => {
    const { last } = run([{ state: 'working' }, { state: 'question' }])
    expect(last).toMatchObject({ phase: 'question', working: false, raise: ['question'] })
    expect(last?.raise).not.toContain('finished')
  })

  it('answering it is work again, which takes the question down', () => {
    const { last } = run([{ state: 'working' }, { state: 'question' }, { state: 'working' }])
    expect(last?.working).toBe(true)
    expect(last?.clear).toContain('question')
  })

  it('a failure is Failed with its kind, and Finished under it for when the Failed line is off', () => {
    const { last } = run([{ state: 'working' }, { state: 'failed', kind: 'rate_limit' }])
    expect(last).toMatchObject({ phase: 'failed', kind: 'rate_limit', working: false })
    expect(last?.raise).toEqual(['failed', 'finished'])
  })

  it('keeps the kind whichever of the two failure hooks lands first', () => {
    expect(run([{ state: 'failed', kind: 'overloaded' }, { state: 'failed' }]).s?.kind).toBe('overloaded')
    expect(run([{ state: 'failed' }, { state: 'failed', kind: 'overloaded' }]).s?.kind).toBe('overloaded')
    expect(run([{ state: 'failed' }]).s?.kind).toBeUndefined()
  })

  it('a new prompt clears a failure, and the next failure starts without the old kind', () => {
    const { last } = run([{ state: 'failed', kind: 'rate_limit' }, { state: 'working' }])
    expect(last?.clear).toContain('failed')
    expect(run([{ state: 'failed', kind: 'rate_limit' }, { state: 'working' }, { state: 'failed' }]).s?.kind).toBeUndefined()
  })

  it('an idle title after work with no Stop is an Esc: idle, and no Finished line', () => {
    const { last } = run([{ state: 'working' }, { state: 'idle-title' }])
    expect(last).toEqual({ phase: 'stopped', working: false, raise: [], clear: [] })
  })

  it('an idle title anywhere else changes nothing', () => {
    for (const before of ['question', 'done', 'failed'] as const)
      expect(run([{ state: before }, { state: 'idle-title' }]).last).toBeNull()
    expect(hookStep(undefined, { state: 'idle-title' })).toBeNull()
  })

  it('a Stop that lands after the idle title still finishes', () => {
    const { last } = run([{ state: 'working' }, { state: 'idle-title' }, { state: 'done' }])
    expect(last?.raise).toEqual(['finished'])
  })
})

// A QUESTION LASTS UNTIL IT IS ANSWERED (#144; owner, 2026-10-09: "it should
// only disappear if you actually answered the question").
describe('raisedWhileSeen', () => {
  it('a question goes up on the tab in front too: being seen is not an answer', () => {
    expect(raisedWhileSeen('question')).toBe(true)
  })
  it('finished and failed are news, which a look has already told', () => {
    expect(raisedWhileSeen('finished')).toBe(false)
    expect(raisedWhileSeen('failed')).toBe(false)
  })
})

// A SPINNER AFTER A QUESTION IS THE APPROVED WORK (#148). MEASURED, Claude Code
// 2.1.296: after Yes no hook fires until PostToolUse, 26 s later for a 25 s
// sleep; the spinner title came back 34 ms after the key.
describe('hookStep, a working title', () => {
  const working = { phase: 'working', working: true, raise: [], clear: ['question'] }
  it('after a question, the spinner is Working, and takes the question down', () => {
    expect(run([{ state: 'working' }, { state: 'question' }, { state: 'working-title' }]).last).toEqual(working)
  })
  it('after an Esc\'s stop too, for a prompt whose question signal never came', () => {
    expect(run([{ state: 'working' }, { state: 'idle-title' }, { state: 'working-title' }]).last).toEqual(working)
  })
  it('anywhere else it changes nothing: a last frame racing a Stop does not relight a finish', () => {
    for (const before of ['working', 'done', 'failed'] as const)
      expect(run([{ state: before }, { state: 'working-title' }]).last).toBeNull()
    expect(hookStep(undefined, { state: 'working-title' })).toBeNull()
  })
  it('a No or an Esc to the box leaves the title idle, so nothing turns Working on (case B)', () => {
    const { s } = run([{ state: 'working' }, { state: 'idle-title' }, { state: 'question' }, { state: 'idle-title' }])
    expect(s?.phase).toBe('question')
  })
})

// WHILE THE BOX IS ON SCREEN, THE QUESTION STANDS (#148). MEASURED, case G2: a
// sibling agent's PreToolUse and PostToolUse, and the main turn's Stop, arrived
// while a subagent's box waited, and each took the line down.
describe('screenDecides', () => {
  const phases: (HookPhase | undefined)[] = [undefined, 'working', 'question', 'done', 'failed', 'stopped']
  const events: HookEvent[] = [
    { state: 'working' },
    { state: 'working-title' },
    { state: 'done' },
    { state: 'question' },
    { state: 'failed' },
    { state: 'idle-title' }
  ]
  it('reads the screen only for work or a Stop while a question is pending', () => {
    for (const p of phases)
      for (const ev of events) {
        const want = p === 'question' && ['working', 'working-title', 'done'].includes(ev.state)
        expect(screenDecides(p ? { phase: p } : undefined, ev), `${p} + ${ev.state}`).toBe(want)
      }
  })
})

describe('hookStep, the box on screen', () => {
  const asked: HookSession = { phase: 'question' }
  const up = { questionOnScreen: true }
  it('work from any agent leaves the question standing', () => {
    expect(hookStep(asked, { state: 'working' }, up)).toBeNull()
    expect(hookStep(asked, { state: 'working-title' }, up)).toBeNull()
  })
  it('a Stop raises Finished under it and keeps the question', () => {
    expect(hookStep(asked, { state: 'done' }, up)).toEqual({ phase: 'question', working: false, raise: ['finished'], clear: [] })
  })
  it('a question or a failure is as without it', () => {
    for (const ev of [{ state: 'question' }, { state: 'failed', kind: 'rate_limit' }] as HookEvent[])
      expect(hookStep(asked, ev, up)).toEqual(hookStep(asked, ev))
  })
  it('with the box gone, or nothing read, every step is as before', () => {
    for (const ev of [{ state: 'working' }, { state: 'working-title' }, { state: 'done' }] as HookEvent[]) {
      expect(hookStep(asked, ev, { questionOnScreen: false })).toEqual(hookStep(asked, ev))
    }
    expect(hookStep(asked, { state: 'working' })?.clear).toContain('question')
    expect(hookStep(asked, { state: 'done' })?.clear).toContain('question')
  })
})
// A STOP WITH THE SPINNER UP WAITS FOR THE NEXT TITLE (#149). MEASURED, case
// G2: after a lone Stop the idle star follows in 18 to 84 ms; with background
// subagents still at work the spinner carries on until the last one ends.
describe('hookStep, a Stop with the spinner up', () => {
  const spinning = { titleWorking: true }
  const ending = (): HookSession => ({ phase: 'ending' })
  it('is not a finish yet: still Working, and the next title decides', () => {
    expect(hookStep({ phase: 'working' }, { state: 'done' }, spinning)).toEqual({
      phase: 'ending',
      working: true,
      raise: [],
      clear: ['question', 'failed']
    })
  })
  it('the star next is the finish', () => {
    expect(hookStep(ending(), { state: 'idle-title' })).toMatchObject({ phase: 'done', working: false, raise: ['finished'] })
  })
  it('another spinner frame is background work: Working, no finish, until the star ends it', () => {
    const bg = hookStep(ending(), { state: 'working-title' })
    expect(bg).toEqual({ phase: 'background', working: true, raise: [], clear: [] })
    expect(hookStep({ phase: 'background' }, { state: 'working-title' })).toBeNull()
    expect(hookStep({ phase: 'background' }, { state: 'idle-title' })).toMatchObject({ phase: 'done', raise: ['finished'] })
  })
  it('no title at all in time: settles as a plain finish, and settling does nothing anywhere else', () => {
    expect(hookStep(ending(), { state: 'settle' })).toMatchObject({ phase: 'done', raise: ['finished'] })
    for (const phase of ['working', 'question', 'done', 'background'] as const)
      expect(hookStep({ phase }, { state: 'settle' })).toBeNull()
  })
  it('with the star already up, a Stop finishes at once, as before', () => {
    expect(hookStep({ phase: 'working' }, { state: 'done' }, { titleWorking: false })?.raise).toEqual(['finished'])
  })
})
