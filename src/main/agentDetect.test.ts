import { describe, expect, it } from 'vitest'
import { looksLikeAgent, treeHasAgent, type ProcRow } from './agentDetect'

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
