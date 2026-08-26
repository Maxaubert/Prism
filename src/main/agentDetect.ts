// Is an AI agent (Claude Code, codex, and kin) running under a shell? The tab
// dots are agent-scoped: a plain terminal never shows one. Detection walks the
// process tree under each pty's shell and matches command lines against the
// agents' PACKAGE signatures - not bare words, because this machine's dev
// folder is literally named "Claude" and any tool touching files there would
// otherwise light the dot.

export interface ProcRow {
  pid: number
  ppid: number
  cmd: string
}

/** The signatures. claude-code is the npm package dir every claude invocation
 *  runs from; the others are their own names as path/package segments. */
// claude also ships as a native claude.exe (a compiled launcher), so the
// FINAL basename counts too: ...in\claude.exe matches, a mid-path folder
// like ...\Documents\Claude\Github does not (the segment is followed by a
// separator, not the end of the token).
const AGENT_RE = /claude-code|[\\/]claude(\.exe|\.cmd|\.ps1)?(["\s]|$)|[\\/](codex|aider|gemini)([\\/.]|["\s]|$)|@openai[\\/]codex|gemini-cli/i

export function looksLikeAgent(cmd: string): boolean {
  return AGENT_RE.test(cmd)
}

/** The two agents whose sessions Prism can resume, each by its own flag:
 *  `claude --resume <id>` and `codex resume --last`. Anything else is 'other'
 *  - it still lights the dot, it just has nothing to come back to. */
const CLAUDE_RE = /claude-code|[\\/]claude(\.exe|\.cmd|\.ps1)?(["\s]|$)/i
const CODEX_RE = /[\\/]codex(\.exe|\.cmd|\.ps1)?(["\s]|$)|@openai[\\/]codex/i

/** BFS the tree under `rootPid`: which agent runs there, if any. */
export function treeAgentKind(
  rows: ProcRow[],
  rootPid: number
): 'claude' | 'codex' | 'other' | null {
  const kids = new Map<number, ProcRow[]>()
  for (const r of rows) {
    const list = kids.get(r.ppid) ?? []
    list.push(r)
    kids.set(r.ppid, list)
  }
  const queue = [rootPid]
  const seen = new Set<number>()
  let kind: 'claude' | 'codex' | 'other' | null = null
  while (queue.length) {
    const pid = queue.shift() as number
    if (seen.has(pid)) continue
    seen.add(pid)
    for (const child of kids.get(pid) ?? []) {
      if (looksLikeAgent(child.cmd)) {
        if (CLAUDE_RE.test(child.cmd)) return 'claude'
        if (CODEX_RE.test(child.cmd)) kind = 'codex'
        else if (kind === null) kind = 'other'
      }
      queue.push(child.pid)
    }
  }
  return kind
}

/** BFS the tree under `rootPid`; true if any descendant looks like an agent. */
export function treeHasAgent(rows: ProcRow[], rootPid: number): boolean {
  const kids = new Map<number, ProcRow[]>()
  for (const r of rows) {
    const list = kids.get(r.ppid) ?? []
    list.push(r)
    kids.set(r.ppid, list)
  }
  const queue = [rootPid]
  const seen = new Set<number>()
  while (queue.length) {
    const pid = queue.shift() as number
    if (seen.has(pid)) continue // PID reuse can fake cycles
    seen.add(pid)
    for (const child of kids.get(pid) ?? []) {
      if (looksLikeAgent(child.cmd)) return true
      queue.push(child.pid)
    }
  }
  return false
}
