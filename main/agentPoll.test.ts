import { describe, expect, it } from 'vitest'
import { AGENT_POLL_MAX, AGENT_POLL_MIN, createAgentPoll, type AgentPollDeps } from './agentPoll'

/**
 * The poll's three rules, checked without a process list: ask only when a
 * shell has printed something, back off while the answer holds, and count only
 * a query that answered as having looked.
 */

const CLAUDE = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'

function world(): {
  deps: AgentPollDeps
  sent: Array<[string, boolean, string | null]>
  send: (id: string, has: boolean, kind: string | null) => void
  set: (w: Partial<{ pids: Array<{ id: string; pid: number }>; ticks: number; now: number; out: string | null }>) => void
  asked: () => number
} {
  const w = { pids: [{ id: 't1', pid: 100 }], ticks: 0, now: 0, out: '100 1\n' as string | null }
  let asked = 0
  const sent: Array<[string, boolean, string | null]> = []
  return {
    deps: {
      pids: () => w.pids,
      ticks: () => w.ticks,
      now: () => w.now,
      query: (done) => {
        asked += 1
        done(w.out)
      }
    },
    sent,
    send: (id, has, kind) => sent.push([id, has, kind]),
    set: (next) => Object.assign(w, next),
    asked: () => asked
  }
}

describe('the agent poll', () => {
  // #73, MEASURED: a claude opened and quit inside a 20 s backoff was never
  // seen, so its title's claim was never taken back. A forced look skips the
  // waits, and still sends only what changed.
  it('a forced look sees an agent inside the backoff, and says only what changed', () => {
    const w = world()
    const poll = createAgentPoll(w.send, w.deps)
    poll() // no agent, said once
    w.set({ out: '100 1\n200 100 claude\n', now: 1 }) // claude starts, silently, inside the backoff
    poll()
    expect(w.sent).toEqual([['t1', false, null]])
    poll(true)
    expect(w.sent).toEqual([['t1', false, null], ['t1', true, 'claude']])
    w.set({ out: '100 1\n', now: 2 }) // and quits
    poll(true)
    expect(w.sent.at(-1)).toEqual(['t1', false, null])
    const before = w.sent.length
    poll(true) // the same answer is still not news
    expect(w.sent).toHaveLength(before)
  })

  it('does not look at all while no shell is alive', () => {
    const w = world()
    w.set({ pids: [] })
    createAgentPoll(w.send, w.deps)()
    expect(w.asked()).toBe(0)
  })

  it('reports an agent under a shell, with its kind, once', () => {
    const w = world()
    w.set({ out: `100 1\n200 100 node ${CLAUDE}\n` })
    const poll = createAgentPoll(w.send, w.deps)
    poll()
    expect(w.sent).toEqual([['t1', true, 'claude']])
    // The same answer again is not news.
    w.set({ ticks: 1, now: 60_000 })
    poll()
    expect(w.sent).toHaveLength(1)
  })

  it('skips a shell that has printed nothing since its answer', () => {
    const w = world()
    const poll = createAgentPoll(w.send, w.deps)
    poll()
    expect(w.asked()).toBe(1)
    w.set({ now: 60_000 }) // far past any backoff: only the silence holds it
    poll()
    poll()
    expect(w.asked()).toBe(1)
  })

  it('backs off while the answer holds, and comes back when it changes', () => {
    const w = world()
    const poll = createAgentPoll(w.send, w.deps)
    poll() // t=0: the first answer is a change (nothing -> no agent)
    expect(w.sent).toEqual([['t1', false, null]])
    // Output, but inside the backoff: not asked.
    w.set({ ticks: 1, now: AGENT_POLL_MIN - 1 })
    poll()
    expect(w.asked()).toBe(1)
    // Past it: asked, same answer, so the next wait doubles.
    w.set({ now: AGENT_POLL_MIN })
    poll()
    expect(w.asked()).toBe(2)
    w.set({ ticks: 2, now: AGENT_POLL_MIN + AGENT_POLL_MIN * 2 - 1 })
    poll()
    expect(w.asked()).toBe(2)
    w.set({ now: AGENT_POLL_MIN + AGENT_POLL_MIN * 2 })
    poll()
    expect(w.asked()).toBe(3)
  })

  it('never waits longer than the ceiling', () => {
    const w = world()
    const poll = createAgentPoll(w.send, w.deps)
    let now = 0
    for (let i = 0; i < 12; i += 1) {
      now += AGENT_POLL_MAX
      w.set({ ticks: i, now })
      poll()
    }
    // Every look a full ceiling apart was allowed through.
    expect(w.asked()).toBe(12)
  })

  it('asks at once about a shell nobody has asked about, backoff or not', () => {
    const w = world()
    const poll = createAgentPoll(w.send, w.deps)
    poll()
    w.set({ pids: [{ id: 't1', pid: 100 }, { id: 't2', pid: 300 }], out: '100 1\n300 1\n', now: 1 })
    poll()
    expect(w.asked()).toBe(2)
    expect(w.sent).toContainEqual(['t2', false, null])
  })

  it('does not count a query that failed as having looked', () => {
    const w = world()
    const poll = createAgentPoll(w.send, w.deps)
    w.set({ out: null })
    poll()
    expect(w.sent).toEqual([])
    // Same tick count, but there is still no answer: it asks again.
    w.set({ out: `100 1\n200 100 node ${CLAUDE}\n` })
    poll()
    expect(w.asked()).toBe(2)
    expect(w.sent).toEqual([['t1', true, 'claude']])
  })

  it('forgets a session that ended, so its id starts clean', () => {
    const w = world()
    const poll = createAgentPoll(w.send, w.deps)
    w.set({ out: `100 1\n200 100 node ${CLAUDE}\n` })
    poll()
    // t1 is gone and t2 is what is alive when the next query answers.
    w.set({ pids: [{ id: 't2', pid: 300 }], out: '300 1\n', ticks: 1, now: 60_000 })
    poll()
    // t1 comes back (an id reused): its first answer is news again.
    w.set({ pids: [{ id: 't1', pid: 400 }], out: '400 1\n', ticks: 2, now: 120_000 })
    poll()
    expect(w.sent).toEqual([
      ['t1', true, 'claude'],
      ['t2', false, null],
      ['t1', false, null]
    ])
  })

  // Review 2026-10-11: the shell's prompt takes an agent's keys back at once,
  // and a codex quit and started again between two looks is still "present"
  // to the poll, which says only what changed: it was never armed again.
  it('sends the next answer of a session asked about again, changed or not, past the waits', () => {
    const w = world()
    const poll = createAgentPoll(w.send, w.deps)
    w.set({ out: '100 1\n200 100 codex\n' })
    poll()
    poll.again('t1')
    w.set({ now: 1 }) // quiet and inside the backoff: only the ask lets it through
    poll()
    expect(w.sent).toEqual([
      ['t1', true, 'codex'],
      ['t1', true, 'codex']
    ])
    poll()
    expect(w.asked()).toBe(2) // once answered, the ask is spent
  })

  it('keeps an ask that came during a look for the look after it', () => {
    const w = world()
    let finish: ((out: string | null) => void) | undefined
    const deps = { ...w.deps, query: (done: (out: string | null) => void) => (finish = done) }
    const poll = createAgentPoll(w.send, deps)
    poll()
    poll.again('t1') // the look in flight was taken before this ask
    finish?.('100 1\n')
    expect(w.sent).toEqual([['t1', false, null]])
    poll()
    finish?.('100 1\n')
    expect(w.sent).toEqual([
      ['t1', false, null],
      ['t1', false, null]
    ])
  })
})
