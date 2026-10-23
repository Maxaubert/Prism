import { beforeEach, describe, expect, it } from 'vitest'
import { forgetAgentTitle, readAgentTitle, titleAgent, titleArmsAgent } from './agentTitle'

const read = (t: string): string | null => {
  const r = readAgentTitle('s', t)
  return r ? `${r.kind}:${r.state}` : null
}

beforeEach(() => forgetAgentTitle('s'))

describe('readAgentTitle, the Claude dialect (measured 2026-09-04)', () => {
  it('idle at birth, working from the spinner, idle again when the answer lands', () => {
    expect(read('claude')).toBeNull() // pwsh titling the command it runs
    expect(read('✳ Claude Code')).toBe('claude:idle')
    expect(read('◐ Claude Code')).toBe('claude:working')
    expect(read('◑ Create and read note.txt')).toBe('claude:working')
    expect(read('✳ Create and read note.txt')).toBe('claude:idle')
  })

  it('a spinner before any idle is the agent starting, not working', () => {
    expect(read('◐ Claude Code')).toBe('claude:starting')
    expect(read('✳ Claude Code')).toBe('claude:idle')
    expect(read('◐ Claude Code')).toBe('claude:working')
  })
})

describe('readAgentTitle, the Codex dialect (measured 2026-09-04)', () => {
  it('spins through its startup, is ready at the bare folder name, then works and rests', () => {
    expect(read('yeah')).toBeNull() // nothing learned yet: any shell can be titled a word
    expect(read('⠙ yeah')).toBe('codex:starting')
    expect(read('npm exec @upstash/context7-mcp')).toBeNull() // a child process, mid-startup
    expect(read('⠼ yeah')).toBe('codex:starting')
    expect(read('yeah')).toBe('codex:idle') // MCP loaded: ready
    expect(read('⠴ yeah')).toBe('codex:working')
    expect(read('C:\\WINDOWS\\system32\\cmd.exe ')).toBeNull() // a tool running: no change
    expect(read('⠦ yeah')).toBe('codex:working')
    expect(read('yeah')).toBe('codex:idle')
  })
})

describe('readAgentTitle, Codex asking (#131, measured on 0.153.2)', () => {
  it('reads "Action Required" as waiting on you, in both of its frames', () => {
    expect(read('⠙ proj')).toBe('codex:starting')
    expect(read('proj')).toBe('codex:idle')
    expect(read('⠴ proj')).toBe('codex:working')
    expect(read('[ ! ] Action Required | proj')).toBe('codex:question')
    expect(read('[ . ] Action Required | proj')).toBe('codex:question')
    // Answered: back to work, then at rest under the name it had.
    expect(read('⠦ proj')).toBe('codex:working')
    expect(read('proj')).toBe('codex:idle')
  })

  it('is Codex asking even before anything else was seen', () => {
    expect(read('[ ! ] Action Required | proj')).toBe('codex:question')
  })

  it('is not set off by a title that only mentions it', () => {
    expect(read('Action Required')).toBeNull()
    expect(read('notes [ ! ] Action Required')).toBeNull()
  })
})

describe('readAgentTitle, everything else', () => {
  it('is null for the shell, a command, a path, an empty title', () => {
    expect(read('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBeNull()
    expect(read('')).toBeNull()
    expect(read('* not the glyph')).toBeNull()
  })

  it('forgets a session', () => {
    expect(read('✳ Claude Code')).toBe('claude:idle')
    forgetAgentTitle('s')
    expect(read('◐ Claude Code')).toBe('claude:starting')
  })
})

describe('titleAgent, the title naming an agent with no memory (#175)', () => {
  it("is claude for Claude's spinner and its idle glyph", () => {
    expect(titleAgent('◐ Claude Code')).toBe('claude')
    expect(titleAgent('◓ Create and read note.txt')).toBe('claude')
    expect(titleAgent('✳ Claude Code')).toBe('claude')
  })
  it("is codex for a braille spinner and Codex's Action Required", () => {
    expect(titleAgent('⠙ yeah')).toBe('codex')
    expect(titleAgent('[ ! ] Action Required | proj')).toBe('codex')
  })
  it('is null for a shell, a path, a bare word and an empty title', () => {
    expect(titleAgent('PS C:\\x')).toBeNull()
    expect(titleAgent('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBeNull()
    expect(titleAgent('yeah')).toBeNull() // Codex's idle needs the session's memory
    expect(titleAgent('')).toBeNull()
  })
  it('remembers nothing: a later read is not changed by it', () => {
    expect(titleAgent('◐ Claude Code')).toBe('claude')
    expect(read('◐ Claude Code')).toBe('claude:starting')
  })
})
describe('titleArmsAgent, what may arm Shift+Enter before the poll (#175)', () => {
  it("arms on Claude's glyphs and Codex's Action Required", () => {
    expect(titleArmsAgent('✳ Claude Code')).toBe('claude')
    expect(titleArmsAgent('◐ Claude Code')).toBe('claude')
    expect(titleArmsAgent('[ ! ] Action Required | proj')).toBe('codex')
  })
  it('never on a bare braille spinner: any CLI draws one, and a plain shell would stay armed (#21)', () => {
    expect(titleArmsAgent('⠙ npm install')).toBeNull()
    expect(titleArmsAgent('PS C:\\x')).toBeNull()
  })
})