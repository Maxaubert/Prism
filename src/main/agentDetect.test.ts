import { describe, expect, it } from 'vitest'
import {
  looksLikeAgent,
  parseProcLines,
  treeAgentKind,
  treeHasAgent,
  type ProcRow
} from './agentDetect'

const CLAUDE = String.raw`"C:\Program Files\nodejs\node.exe" "C:\Users\Admin\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js"`
const CODEX = String.raw`node "C:\Users\Admin\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js"`

describe('looksLikeAgent', () => {
  it('matches claude-code and codex by their package paths', () => {
    expect(looksLikeAgent(CLAUDE)).toBe(true)
    expect(looksLikeAgent(CODEX)).toBe(true)
    expect(looksLikeAgent(String.raw`"C:\.local\bin\claude.exe" --resume`)).toBe(true)
    expect(looksLikeAgent(String.raw`C:\npm\claude.cmd`)).toBe(true)
  })
  it('does NOT match a dev folder that happens to be named Claude', () => {
    expect(looksLikeAgent(String.raw`node C:\Users\Admin\Documents\Claude\Github\Prism\out\main\index.js`)).toBe(false)
    expect(looksLikeAgent(String.raw`vitest run C:\Users\Admin\Documents\Claude\Github\Prism`)).toBe(false)
  })
  it('does not match plain shells and tools', () => {
    expect(looksLikeAgent('pwsh.exe -NoLogo')).toBe(false)
    expect(looksLikeAgent(String.raw`C:\WINDOWS\system32\ping.exe -n 3 127.0.0.1`)).toBe(false)
  })
})

describe('treeHasAgent', () => {
  const rows: ProcRow[] = [
    { pid: 10, ppid: 1, cmd: 'pwsh.exe -NoLogo' },
    { pid: 20, ppid: 10, cmd: CLAUDE },
    { pid: 30, ppid: 20, cmd: 'some-helper.exe' },
    { pid: 40, ppid: 1, cmd: 'pwsh.exe -NoLogo' }
  ]
  it('finds an agent anywhere under the shell', () => {
    expect(treeHasAgent(rows, 10)).toBe(true)
  })
  it('a sibling shell with no agent stays clean', () => {
    expect(treeHasAgent(rows, 40)).toBe(false)
  })
  it('survives a pid cycle', () => {
    const loop: ProcRow[] = [
      { pid: 5, ppid: 6, cmd: 'a' },
      { pid: 6, ppid: 5, cmd: 'b' }
    ]
    expect(treeHasAgent(loop, 5)).toBe(false)
  })
})

describe('treeAgentKind', () => {
  const shell = (pid: number): ProcRow => ({ pid, ppid: 1, cmd: 'pwsh.exe -NoLogo' })

  it('names the agent it found, because each resumes differently', () => {
    expect(treeAgentKind([shell(10), { pid: 11, ppid: 10, cmd: CLAUDE }], 10)).toBe('claude')
    expect(treeAgentKind([shell(20), { pid: 21, ppid: 20, cmd: CODEX }], 20)).toBe('codex')
    expect(
      treeAgentKind([shell(30), { pid: 31, ppid: 30, cmd: String.raw`C:in\codex.exe` }], 30)
    ).toBe('codex')
  })

  it('an agent with nothing to resume is just an agent', () => {
    expect(treeAgentKind([shell(40), { pid: 41, ppid: 40, cmd: 'C:/bin/aider' }], 40)).toBe('other')
  })

  it('claude wins when both are under one shell: it is the resumable one', () => {
    const rows = [shell(50), { pid: 51, ppid: 50, cmd: CODEX }, { pid: 52, ppid: 50, cmd: CLAUDE }]
    expect(treeAgentKind(rows, 50)).toBe('claude')
  })

  it('a plain shell hosts nothing', () => {
    expect(treeAgentKind([shell(60)], 60)).toBeNull()
  })
})

describe('the compact process listing', () => {
  it('reads pid and ppid off a row with no command line', () => {
    expect(parseProcLines('1234 5678')).toEqual([{ pid: 1234, ppid: 5678, cmd: '' }])
  })

  it('keeps the whole command line, spaces and quotes and all', () => {
    const cmd = '"C:\\Program Files\\nodejs\\node.exe" C:\\np\\claude-code\\cli.js --resume abc'
    const [row] = parseProcLines(`42 7 ${cmd}`)
    expect(row.cmd).toBe(cmd)
    expect(looksLikeAgent(row.cmd)).toBe(true)
  })

  it('skips blank lines and anything that is not a row', () => {
    const out = '\r\n1 0\r\nSystem.Object[]\r\n\r\n9 1 claude\r\n'
    expect(parseProcLines(out).map((r) => r.pid)).toEqual([1, 9])
  })

  it('feeds the tree walk, so an agent four deep is still found', () => {
    const rows = parseProcLines(['100 1', '200 100', '300 200', '400 300 node claude-code/cli.js'].join('\n'))
    expect(treeAgentKind(rows, 100)).toBe('claude')
    expect(treeAgentKind(rows, 300)).toBe('claude')
    expect(treeAgentKind(rows, 999)).toBe(null)
  })

  it('survives a listing that came back empty', () => {
    expect(parseProcLines('')).toEqual([])
  })
})
