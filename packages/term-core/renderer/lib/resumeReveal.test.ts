import { describe, expect, it } from 'vitest'
import {
  CEILING_MS,
  SETTLE_MS,
  agentOfResume,
  namesAgent,
  onAlternate,
  onChunk,
  onTick,
  revealNow,
  startReveal
} from './resumeReveal'

const title = (t: string, st = '\x07'): string => `\x1b]0;${t}${st}`

describe('resumeReveal', () => {
  it('knows which agent a resume is for', () => {
    expect(agentOfResume('3f2a9c1e-77aa-4c0d-9b1e-0a1b2c3d4e5f')).toBe('claude')
    expect(agentOfResume('codex:last')).toBe('codex')
  })

  it('a title names the agent only when it IS the program, not a command line that mentions it', () => {
    expect(namesAgent('claude', 'claude')).toBe(true)
    expect(namesAgent('C:\\Users\\me\\.local\\bin\\claude.exe', 'claude')).toBe(true)
    expect(namesAgent('pwsh -Command claude --resume abc', 'claude')).toBe(false)
    expect(namesAgent('C:\\Users\\me\\Documents\\Claude\\Github', 'claude')).toBe(false)
    expect(namesAgent('✳ Claude Code', 'claude')).toBe(false)
    expect(namesAgent('codex', 'codex')).toBe(true)
  })

  it('clears just before the title that names the agent, mid-chunk, with either terminator (MEASURED order)', () => {
    const s = startReveal('claude', 0)
    const before = 'PS C:\\work> \x1b[1t\x1b[c\x1b[?1004h'
    const r = onChunk(s, before + title('claude', '\x1b\\') + '\x1b[?25l', 3600)
    expect(r.clearAt).toBe(before.length)
    expect(r.state.cleared).toBe(true)
    // Once only.
    expect(onChunk(r.state, title('claude'), 3700).clearAt).toBe(-1)
  })

  it('never clears on a shell title, nor on the path of a folder called Claude', () => {
    const s = startReveal('claude', 0)
    expect(onChunk(s, title('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 10).clearAt).toBe(-1)
    expect(onChunk(s, title('C:\\Users\\me\\Documents\\Claude'), 10).clearAt).toBe(-1)
  })

  it("reveals a moment after the agent's own title, not at once", () => {
    let s = onChunk(startReveal('claude', 0), title('claude'), 3600).state
    s = onChunk(s, '\x1b[?2004h' + title('✳ Claude Code'), 5410).state
    expect(s.settleAt).toBe(5410 + SETTLE_MS)
    expect(onTick(s, 5410 + SETTLE_MS - 1).revealed).toBe(false)
    expect(onTick(s, 5410 + SETTLE_MS).revealed).toBe(true)
  })

  it('a title BEFORE the agent took the console is not its paint', () => {
    const s = onChunk(startReveal('claude', 0), title('pwsh'), 100).state
    expect(s.settleAt).toBeNull()
  })

  it('reveals after the switch to the alternate screen too', () => {
    const s = onAlternate(startReveal('claude', 0), 5445)
    expect(onTick(s, 5445 + SETTLE_MS).revealed).toBe(true)
  })

  it('reveals at once on a key, an exit or a failed spawn, and at the ceiling in any case', () => {
    expect(revealNow(startReveal('claude', 0)).revealed).toBe(true)
    expect(onTick(startReveal('claude', 0), CEILING_MS - 1).revealed).toBe(false)
    expect(onTick(startReveal('claude', 0), CEILING_MS).revealed).toBe(true)
  })

  it('does nothing more once revealed', () => {
    const s = revealNow(startReveal('claude', 0))
    expect(onChunk(s, title('claude'), 10)).toEqual({ state: s, clearAt: -1 })
  })
})
