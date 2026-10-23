import { describe, expect, it } from 'vitest'
import { answersQuestion, looksLikeQuestion, questionAnswered } from './agentQuestion'

// The bottom of Claude Code's screen in each state (Claude Code 2.1.283,
// 2026-09-28), trimmed to the rows that matter. The question box's footer and
// the finished screen were captured from a real session in a pty. The
// permission prompt could not be: the owner's own hooks approved the command
// before a prompt was drawn, so its shape here is Claude Code's documented
// "Do you want to proceed?" over numbered choices, and is the least certain.
const QUESTION_BOX = [
  '● Which colour do you prefer?',
  '',
  '  ❯ 1. Red',
  '    2. Blue',
  '    3. Type something.',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel'
]
const PERMISSION = [
  ' Bash command',
  '',
  '   echo hello-signals',
  '   Print a test string',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for echo commands in this folder",
  '   3. No, and tell Claude what to do differently (esc)'
]
const FINISHED = [
  '● I ran the command and it printed: hello-signals',
  '',
  '✻ Worked for 7s · done 18:49',
  '',
  '────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────',
  '  ⏵⏵ auto mode on (shift+tab to cycle)'
]

describe('looksLikeQuestion', () => {
  it("knows the question tool's box", () => {
    expect(looksLikeQuestion(QUESTION_BOX)).toBe(true)
  })
  it('knows a permission prompt', () => {
    expect(looksLikeQuestion(PERMISSION)).toBe(true)
  })
  it('does not take a finished answer, or an idle prompt, for a question', () => {
    expect(looksLikeQuestion(FINISHED)).toBe(false)
    expect(looksLikeQuestion(['PS C:\\Users\\me> '])).toBe(false)
  })
  it('does not take an answer that merely mentions the words for a question', () => {
    expect(looksLikeQuestion(['Press Esc to cancel a build.', 'Done.'])).toBe(false)
    expect(looksLikeQuestion(['Do you want to know more? Read the docs.'])).toBe(false)
  })
})

// A QUESTION LASTS UNTIL IT IS ANSWERED (#144). No hook fires when a
// permission prompt is turned down or a question is cancelled with Esc, so
// the keys that settle a box, and the box gone after them, are the answer.
describe('answersQuestion', () => {
  it('Enter, Esc, Ctrl+C and a numbered choice settle a question box', () => {
    for (const k of ['\r', '\x1b', '\x03', '1', '3', '9']) expect(answersQuestion(k)).toBe(true)
  })
  it('walking the choices or typing a letter does not', () => {
    for (const k of ['\x1b[A', '\x1b[B', '\t', 'a', ' ', '0', '12', '']) expect(answersQuestion(k)).toBe(false)
  })
})

describe('questionAnswered', () => {
  it('an answering key with the box gone is an answer', () => {
    expect(questionAnswered('\r', FINISHED)).toBe(true)
    expect(questionAnswered('\x1b', ['PS C:\\Users\\me> '])).toBe(true)
  })
  it('the box still up (the next of several questions) is not', () => {
    expect(questionAnswered('\r', QUESTION_BOX)).toBe(false)
    expect(questionAnswered('1', PERMISSION)).toBe(false)
  })
  it('a key that answers nothing is not, whatever the screen says', () => {
    expect(questionAnswered('\x1b[B', FINISHED)).toBe(false)
  })
})

// MEASURED for #148 (Claude Code 2.1.296, 2026-10-10, a real claude.exe in a
// ConPTY pty, 140 x 45): the rows `readScreenTail` returns, rendered from the
// captured bytes. Case A at 13800 ms, the permission box up; the same session at
// 22900 ms, 40 ms after Yes, the box repainted away; case G2 at 30000 ms, a
// background subagent's box with two agents running; and G2 after its Yes.
const RULE = '╌'.repeat(40)
const A_BOX = [
  '  ⎿  Waiting…',
  '',
  '─'.repeat(40),
  ' Bash command',
  ' Run a 25-second sleep via PowerShell',
  RULE,
  ' powershell -NoProfile -Command Start-Sleep 25',
  RULE,
  ' Permission rule Bash(powershell *) requires confirmation for this command.',
  ' /permissions to update rules',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend'
]
const A_AFTER_YES = [
  '❯ Use the Bash tool to run exactly this command once, nothing else, then reply OK: powershell -NoProfile -Command Start-Sleep 25',
  '',
  '● Bash(powershell -NoProfile -Command Start-Sleep 25)',
  '  ⎿  Running…',
  '',
  '✻ Cultivating… (4s · ↓ 220 tokens)',
  '',
  '─'.repeat(40),
  '❯ ',
  '─'.repeat(40),
  '  ⏸ manual mode on · esc to interrupt · ← 3 agents                                       ◐ medium · /effort'
]
const G2_BOX = [
  '✻ Waiting for 2 background agents to finish',
  '',
  '─'.repeat(40),
  ' Bash command · from the general-purpose agent',
  ' Run a 25-second sleep via PowerShell',
  RULE,
  ' powershell -NoProfile -Command Start-Sleep 25',
  RULE,
  ' Permission rule Bash(powershell *) requires confirmation for this command.',
  ' /permissions to update rules',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend · ctrl+x ctrl+k twice to stop background agents'
]
const G2_AFTER_YES = [
  '✻ Waiting for 2 background agents to finish',
  '',
  '─'.repeat(40),
  '❯ ',
  '─'.repeat(40),
  '  ⏸ manual mode on · ? for shortcuts · ← 3 agents · ↓ to manage                        ◐ medium · /effort',
  '',
  '  ● main',
  '  ◯ general-purpose  Run 25s sleep command                                     19s · ↓ 34.6k tokens',
  '  ◯ general-purpose  Run five sequential echo calls                            19s · ↓ 37.3k tokens'
]

describe('looksLikeQuestion, on the screens measured for #148', () => {
  it('the permission box is seen, the main agent\'s and a subagent\'s', () => {
    expect(looksLikeQuestion(A_BOX)).toBe(true)
    expect(looksLikeQuestion(G2_BOX)).toBe(true)
  })
  it('the repaint after Yes is not a question, agents footer and all', () => {
    expect(looksLikeQuestion(A_AFTER_YES)).toBe(false)
    expect(looksLikeQuestion(G2_AFTER_YES)).toBe(false)
  })
  it('the box fits the 16 rows the indicator reads', () => {
    expect(A_BOX.length).toBeLessThanOrEqual(16)
    expect(G2_BOX.length).toBeLessThanOrEqual(16)
  })
})
