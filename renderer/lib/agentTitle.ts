/**
 * What an agent says about itself through the terminal TITLE (2026-09-04).
 *
 * MEASURED on real sessions, two dialects:
 *
 * Claude Code writes "✳ Claude Code" at idle, a half-circle spinner glyph
 * ("◐ Claude Code", cycling ◐ ◑ ◒ ◓) from 30ms after Enter, held through
 * tool calls, and "✳ <task>" the instant the answer lands.
 *
 * Codex writes a braille spinner in front of the FOLDER NAME while busy
 * ("⠙ yeah", cycling ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) and the bare folder name ("yeah") when
 * idle - during its startup too, where the spinner runs while MCP servers
 * load and the bare name marks the moment it is ready. Its child processes
 * set titles of their own in between ("npm", "cmd.exe"), which mean nothing.
 *
 * So the reader is PER SESSION and remembers two things: the name after the
 * spinner (the bare form of it is Codex's idle), and whether the agent has
 * been idle once - a spinner before the first idle is the agent STARTING,
 * which is present but not working (owner: startup is not work). Braille
 * spinners are common currency (ora, and every CLI built on it), so a
 * braille title alone is not taken as proof of Codex; App acts on it only
 * once the process poll has found an agent. Claude's glyphs are its own.
 */

const HALF = new Set(['◐', '◑', '◒', '◓'])
const IDLE_GLYPH = '✳'
const isBraille = (c: string): boolean => {
  const cp = c.codePointAt(0) ?? 0
  return cp >= 0x2800 && cp <= 0x28ff
}

/** `question`: Codex waits on you (#131; its "Action Required" title). */
export type AgentTitleState = 'working' | 'idle' | 'starting' | 'question'

/**
 * CODEX ASKING (#131). MEASURED on Codex CLI 0.153.2: while it waits for an
 * approval its title is `[ ! ] Action Required | <folder>`, alternating with
 * `[ . ] Action Required | <folder>`; at rest it goes back to the bare folder.
 */
const CODEX_ASKS = /^\[\s*[!.]\s*\]\s*Action Required\b/
export interface AgentTitle {
  kind: 'claude' | 'codex'
  state: AgentTitleState
}

interface Seen {
  kind: 'claude' | 'codex'
  /** The text after the spinner, whose bare form is the idle title. */
  name: string
  /** Idle seen at least once: spinners before it are the startup. */
  ready: boolean
}

const seen = new Map<string, Seen>()

/**
 * The agent a title NAMES on its own, with no session memory (#175): Claude's
 * half-circle spinner or idle glyph, a braille spinner or Codex's "Action
 * Required". A bare folder name (Codex at rest) needs the memory and is null.
 * A braille spinner alone is weak proof of Codex: see `titleArmsAgent`.
 */
export function titleAgent(title: string): 'claude' | 'codex' | null {
  const t = title.trim()
  const first = [...t][0]
  if (!first) return null
  if (CODEX_ASKS.test(t)) return 'codex'
  if (HALF.has(first) || first === IDLE_GLYPH) return 'claude'
  if (isBraille(first)) return 'codex'
  return null
}

/**
 * The agent a title is proof enough of to ARM Shift+Enter's newline before the
 * poll (#175): `titleAgent` less a bare braille spinner. That spinner is any
 * CLI's (ora, npm), and in a plain shell it would arm a `\` + Enter that the
 * poll, never having seen an agent there, would never take back: the line run
 * with a backslash on its end (code review 2026-09-24, #21).
 */
export function titleArmsAgent(title: string): 'claude' | 'codex' | null {
  const named = titleAgent(title)
  return named === 'codex' && !CODEX_ASKS.test(title.trim()) ? null : named
}

/** Read one title change for a session. Null when it says nothing about an agent. */
export function readAgentTitle(id: string, title: string): AgentTitle | null {
  const t = title.trim()
  const first = [...t][0]
  if (!first) return null
  const rest = t.slice(first.length).trim()
  const s = seen.get(id)
  const named = titleAgent(t)
  if (named === 'codex' && CODEX_ASKS.test(t)) {
    // Asking is past startup; the name it returns to at rest is kept.
    if (s?.kind === 'codex') s.ready = true
    else seen.set(id, { kind: 'codex', name: s?.name ?? '', ready: true })
    return { kind: 'codex', state: 'question' }
  }
  // What is left that names an agent is a spinner, or Claude's idle glyph.
  if (named && first !== IDLE_GLYPH) {
    const kind = named
    const next: Seen = { kind, name: rest, ready: s?.kind === kind ? s.ready : false }
    seen.set(id, next)
    return { kind, state: next.ready ? 'working' : 'starting' }
  }
  if (named === 'claude') {
    const next: Seen = { kind: 'claude', name: s?.kind === 'claude' ? s.name : rest, ready: true }
    seen.set(id, next)
    return { kind: 'claude', state: 'idle' }
  }
  if (s && s.name && t === s.name) {
    s.ready = true
    return { kind: s.kind, state: 'idle' }
  }
  return null
}

/** The session ended, or its agent left. */
export function forgetAgentTitle(id: string): void {
  seen.delete(id)
}
