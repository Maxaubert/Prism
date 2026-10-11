import { describe, expect, it } from 'vitest'
import { armAtStart, armOnPoll, armOnPrompt, armOnTitle, type AgentArm } from './agentArm'

const IDLE = '✳ Claude Code'
const ASKS = '[ ! ] Action Required | yeah'

const titled = (title: string, s: AgentArm = armAtStart(null)): AgentArm => armOnTitle(s, title).arm
const polled = (s: AgentArm, kind: 'claude' | 'codex' | 'other' = 'claude'): AgentArm => armOnPoll(s, true, kind).arm

describe('agentArm', () => {
  it('starts armed for a resumed agent, bare otherwise', () => {
    expect(armAtStart('claude')).toMatchObject({ here: true, kind: 'claude' })
    expect(armAtStart(null)).toMatchObject({ here: false, kind: null })
  })

  it("is armed by the agent's own title before the poll (#175)", () => {
    expect(titled(IDLE)).toMatchObject({ here: true, kind: 'claude' })
  })

  it('is not armed by a bare braille spinner', () => {
    expect(titled('⠙ npm')).toMatchObject({ here: false, kind: null })
  })

  it("is disarmed by the poll's left (#73), and that ends what the agent asked for", () => {
    const step = armOnPoll(polled(titled(IDLE)), false, null)
    expect(step.arm).toMatchObject({ here: false, kind: null })
    expect(step.gone).toBe(true)
  })

  it("keeps the title's agent when the poll only sees a wrapper", () => {
    expect(polled(titled(IDLE), 'other')).toMatchObject({ here: true, kind: 'claude' })
  })

  // Review 2026-10-11: a restored tab starts armed by its resume, and the
  // poll's FIRST answer can be taken before claude has started. Read as the
  // agent leaving, it turned Claude's theme reports off for good and took
  // Shift+Enter and Alt+V back until the next change the poll reported.
  it("does not take a resume's agent back on the poll's first 'no agent'", () => {
    const step = armOnPoll(armAtStart('claude'), false, null)
    expect(step.arm).toMatchObject({ here: true, kind: 'claude' })
    expect(step.gone).toBe(false)
    // It asks the poll for its next answer, changed or not, to confirm.
    expect(step.recheck).toBe(true)
  })

  it("takes a resume's agent back when the poll says 'no agent' twice", () => {
    const once = armOnPoll(armAtStart('claude'), false, null).arm
    const twice = armOnPoll(once, false, null)
    expect(twice.arm).toMatchObject({ here: false, kind: null })
    expect(twice.gone).toBe(false)
    expect(twice.recheck).toBe(false)
  })

  // MEASURED (e2e termReplies, 2026-10-11): the first verdict landed after a
  // program that is no agent had sent ?2031h, and ending the reports then told
  // it nothing on a theme switch.
  it("is no departure on a first 'no agent' with nothing armed", () => {
    expect(armOnPoll(armAtStart(null), false, null).gone).toBe(false)
  })

  // A WSL tab: the poll sees wsl.exe, never claude, so its "no agent" says
  // nothing about the agent the title armed. The title says when it goes.
  it("keeps a title's agent on the poll's 'no agent'", () => {
    const step = armOnPoll(titled(IDLE), false, null)
    expect(step.arm).toMatchObject({ here: true, kind: 'claude' })
    expect(step.gone).toBe(false)
  })

  // Review 2026-10-11: in WSL no prompt report comes (bash prints no OSC 9;9)
  // and the poll never sees claude, so after claude exited the tab kept its
  // keys, and a stale ?2031h typed ESC[?997;Nn into bash on a theme switch.
  it("is disarmed when the title stops naming a title-armed agent, and that ends its reports", () => {
    const step = armOnTitle(titled('◐ Claude Code'), 'me@box: ~/src')
    expect(step.arm).toMatchObject({ here: false, kind: null })
    expect(step.gone).toBe(true)
  })

  it("keeps a title-armed agent through its own titles", () => {
    let s = titled(IDLE)
    for (const t of ['◐ Claude Code', '◓ Claude Code', '✳ Fix the bug']) s = titled(t, s)
    expect(s).toMatchObject({ here: true, kind: 'claude' })
  })

  it('takes an empty title as the agent gone', () => {
    expect(armOnTitle(titled(IDLE), '').arm).toMatchObject({ here: false })
  })

  // Codex's title names it only while it asks; at rest it is the bare folder
  // the question named, and busy that folder behind a braille spinner.
  it("keeps a title-armed Codex at rest and busy", () => {
    let s = titled(ASKS)
    expect(s).toMatchObject({ here: true, kind: 'codex' })
    for (const t of ['yeah', '⠙ yeah', '[ . ] Action Required | yeah', 'yeah']) s = titled(t, s)
    expect(s).toMatchObject({ here: true, kind: 'codex' })
    expect(armOnTitle(s, 'me@box: ~').arm).toMatchObject({ here: false })
  })

  // An agent the poll saw is the poll's: its title is not asked.
  it("leaves a polled agent to the poll when the title changes", () => {
    const s = polled(titled(IDLE))
    const step = armOnTitle(s, 'npm')
    expect(step.arm).toMatchObject({ here: true, kind: 'claude' })
    expect(step.gone).toBe(false)
  })

  it('is disarmed by the prompt when only the title armed it', () => {
    expect(armOnPrompt(titled(IDLE)).arm).toMatchObject({ here: false, kind: null })
  })

  it('is disarmed by the prompt after a resumed agent ends', () => {
    expect(armOnPrompt(armAtStart('codex')).arm).toMatchObject({ here: false, kind: null })
  })

  // Review 2026-10-11: the prompt proves nothing runs in front of the shell.
  // Keeping a poll-seen agent armed past it sent ESC v to PSReadLine on an
  // image paste for up to 20 s, and PSReadLine's RevertLine wiped the line.
  // The poll is asked for its next answer, changed or not, so a Codex
  // restarted between two looks still gets its keys back.
  it('is disarmed by the prompt even when the poll saw the agent, and asks the poll again', () => {
    const step = armOnPrompt(polled(armAtStart(null), 'codex'))
    expect(step.arm).toMatchObject({ here: false, kind: null })
    expect(step.recheck).toBe(true)
    expect(step.gone).toBe(true)
  })

  it('does not ask the poll again on a prompt it has nothing to correct', () => {
    expect(armOnPrompt(armAtStart(null)).recheck).toBe(false)
    expect(armOnPrompt(titled(IDLE)).recheck).toBe(false)
  })

  it('is armed again when the poll answers after the prompt', () => {
    const after = armOnPrompt(polled(armAtStart(null), 'codex')).arm
    expect(polled(after, 'codex')).toMatchObject({ here: true, kind: 'codex' })
  })
})
