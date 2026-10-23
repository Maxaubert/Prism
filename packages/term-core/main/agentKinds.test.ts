import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESUMABLE_AGENTS, isResumable } from '../shared/types'
import { looksLikeAgent, treeAgentKind } from './agentDetect'

// ONE LIST OF RESUMABLE AGENTS (audit 2026-10-12). Every place that must know
// an agent by name is checked against RESUMABLE_AGENTS, so adding a third one
// fails here until detection, the poll's prefilter and the saved tabs know it.
describe('the resumable agents', () => {
  it('are each detected by the process poll, by name', () => {
    for (const name of RESUMABLE_AGENTS) {
      expect(looksLikeAgent(name), name).toBe(true)
      expect(treeAgentKind([{ pid: 2, ppid: 1, cmd: `${name} --x` }], 1), name).toBe(name)
    }
  })
  it("are each let through the poll's broad prefilter", () => {
    const poll = readFileSync(join(__dirname, 'agentPoll.ts'), 'utf8')
    const pre = /-match ' \+\s*"'([^']+)'/.exec(poll)?.[1] ?? ''
    for (const name of RESUMABLE_AGENTS) expect(pre.split('|'), name).toContain(name)
  })
  it('isResumable is the one test, and says no to the rest', () => {
    expect(RESUMABLE_AGENTS.every(isResumable)).toBe(true)
    for (const k of ['other', 'aider', '', undefined, null]) expect(isResumable(k)).toBe(false)
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) return walk(p)
        return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
      })
    // The core is packages/term-core here, the host's own code is src (the repo root is three up).
    const root = join(__dirname, '..', '..', '..')
    const byHand = [...walk(join(root, 'packages', 'term-core')), ...walk(join(root, 'src'))]
      .filter((f) => /=== 'claude' \|\| \S+ === 'codex'|'claude' \| 'codex'/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split('\\').join('/'))
    expect(byHand).toEqual([])
  })
})
