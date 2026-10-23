import { execFileSync } from 'child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

/**
 * The catch-up digest (2026-10-16), run as the skill runs it (Windows
 * PowerShell 5.1, -File) on transcripts written in the shapes MEASURED on real
 * ones: an owner prompt is origin.kind "human"; one assistant message spans
 * several lines; a prompt typed while Claude works may exist only as a
 * queued_command attachment; assistant lines land late; a pasted image makes
 * the content a list.
 */

const SCRIPT = join(__dirname, '..', 'claude-plugin-orchestrator', 'skills', 'catch-up', 'catch-up.ps1')
const W = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SELF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const QUIET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const t = (min: number, sec = 0): string => new Date(Date.UTC(2026, 9, 16, 8, min, sec)).toISOString()
const line = (o: object): string => JSON.stringify(o) + '\n'
const owner = (at: string, content: unknown): string =>
  line({ type: 'user', timestamp: at, origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content } })
const say = (at: string, id: string, text: string, stop = 'end_turn'): string =>
  line({ type: 'assistant', timestamp: at, message: { id, model: 'claude-opus-5-5', stop_reason: stop, content: [{ type: 'text', text }] } })
const tool = (at: string, id: string, name: string, input: object, useId = 'toolu_1'): string =>
  line({ type: 'assistant', timestamp: at, message: { id, model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: useId, name, input }] } })

function world() {
  const root = mkdtempSync(join(tmpdir(), 'pt-catchup-'))
  const config = join(root, 'claude')
  const proj = join(config, 'projects', 'C--src-wind')
  mkdirSync(proj, { recursive: true })
  const app = join(root, 'app')
  mkdirSync(app)
  const file = join(app, 'sessions.json')
  const sessions = (recs: Record<string, object>, tabs: object[] = []): void =>
    writeFileSync(file, JSON.stringify({ version: 1, app: 'PrismTerminal', pid: 999999, updatedAt: t(59), tabs, sessions: recs }))
  const transcript = (id: string, text: string): string => {
    const f = join(proj, `${id}.jsonl`)
    appendFileSync(f, text)
    return f
  }
  const run = (...args: string[]): { out: string; code: number } => {
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, PRISM_SESSIONS_FILE: file, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: SELF }
      })
      return { out, code: 0 }
    } catch (e) {
      const err = e as { stdout?: string; status?: number }
      return { out: err.stdout ?? '', code: err.status ?? -1 }
    }
  }
  const commit = (out: string): string => /COMMIT=([0-9a-f]+)/.exec(out)?.[1] ?? ''
  return { app, file, sessions, transcript, run, commit }
}

const rec = (over: object = {}): object => ({ label: 'Wind', cwd: 'C:\\src\\wind', firstKnownAt: t(0), lastHookAt: t(50), open: true, seen: null, ...over })

describe.runIf(process.platform === 'win32')('the catch-up digest', () => {
  // Each case starts Windows PowerShell several times: seconds on a busy PC.
  vi.setConfig({ testTimeout: 60_000 })
  it('reports prompts, the answer of each turn and the facts, then nothing twice', () => {
    const w = world()
    w.sessions({ [W]: rec() }, [{ tab: 'x', label: 'Wind', cwd: 'C:\\src\\wind', agent: 'claude', state: 'done', front: false, session: W }])
    w.transcript(
      W,
      owner(t(10), 'Fiks søkefeltet, og lag en PR') +
        say(t(11), 'msg_1', 'Looking at it.', 'tool_use') +
        tool(t(12), 'msg_1', 'Bash', { command: 'git commit -m "fix search"', description: 'Commit the search fix' }) +
        line({ type: 'pr-link', timestamp: t(13), prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', prRepository: 'o/r' }) +
        say(t(14), 'msg_2', 'Done: the search box ') +
        say(t(14), 'msg_2', 'is fixed in PR #7.')
    )
    const first = w.run()
    expect(first.code).toBe(0)
    expect(first.out).toContain('Owner: Fiks søkefeltet, og lag en PR')
    expect(first.out).toContain('Claude: Done: the search box is fixed in PR #7.')
    expect(first.out).toContain('did: git commit - Commit the search fix')
    expect(first.out).toContain('PR: https://github.com/o/r/pull/7')
    expect(first.out).not.toContain('Looking at it.')
    expect(w.run('-Commit', w.commit(first.out)).out).toContain('COMMITTED 1')
    const second = w.run()
    expect(second.out).toContain('Nothing new in any session')
    // Something new after the report: only that is told.
    w.transcript(W, owner(t(51), 'And the tests?') + say(t(52), 'msg_3', 'All pass.'))
    // Its hook comes after the report was committed (the commit stamps the
    // real clock).
    w.sessions({ [W]: rec({ lastHookAt: new Date(Date.now() + 60_000).toISOString() }) })
    const third = w.run()
    expect(third.out).toContain('Owner: And the tests?')
    expect(third.out).not.toContain('search box')
  })

  it('skips what the owner saw, but keeps a line written late for a turn they did not', () => {
    const w = world()
    w.sessions({ [W]: rec({ seen: t(20) }) })
    w.transcript(
      W,
      owner(t(5), 'old ask') +
        say(t(6), 'm0', 'old answer') +
        owner(t(19, 30), 'new ask just before leaving') +
        say(t(21), 'm1', 'the answer came after they left')
    )
    const out = w.run().out
    expect(out).not.toContain('old ask')
    expect(out).toContain('new ask just before leaving')
    expect(out).toContain('the answer came after they left')
  })

  it('reads image prompts, queued prompts, compaction and background work the way Claude writes them', () => {
    const w = world()
    w.sessions({ [W]: rec() })
    w.transcript(
      W,
      owner(t(10), [{ type: 'text', text: 'what is this' }, { type: 'image', source: { type: 'base64', data: 'AAAA' } }]) +
        line({ type: 'attachment', timestamp: t(11), attachment: { type: 'queued_command', prompt: 'also check the tests', origin: { kind: 'human' } } }) +
        line({ type: 'user', timestamp: t(12), isCompactSummary: true, message: { role: 'user', content: 'This session is being continued...' } }) +
        line({ type: 'system', subtype: 'compact_boundary', timestamp: t(12) }) +
        line({ type: 'user', timestamp: t(13), origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification><summary>e2e passed</summary></task-notification>' } }) +
        say(t(14), 'm1', 'All good.')
    )
    const out = w.run().out
    expect(out).toContain('Owner: what is this [image]')
    expect(out).not.toContain('AAAA')
    expect(out).toContain('Owner (sent while working): also check the tests')
    expect(out).not.toContain('This session is being continued')
    expect(out).toContain('(context compacted)')
    expect(out).toContain('background task finished: e2e passed')
  })

  it('says a question still open needs the owner, and an answered one as question and answer', () => {
    const w = world()
    w.sessions({ [W]: rec() })
    const ask = (id: string, q: string): object => ({ questions: [{ question: q, header: 'h', options: [], multiSelect: false }], _id: id })
    w.transcript(
      W,
      owner(t(10), 'go') +
        tool(t(11), 'm1', 'AskUserQuestion', ask('a', 'Merge #1?'), 'toolu_a') +
        line({ type: 'user', timestamp: t(12), toolUseResult: { answers: { 'Merge #1?': 'Yes' } }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'ok' }] } }) +
        tool(t(13), 'm2', 'AskUserQuestion', ask('b', 'Install 0.56?'), 'toolu_b')
    )
    const out = w.run().out
    expect(out).toContain('asked: Merge #1? -> Yes')
    expect(out).toContain('NEEDS YOU: open question: Install 0.56?')
  })

  it('stops before a half-written last line, and skips the session asking', () => {
    const w = world()
    w.sessions({ [W]: rec(), [SELF]: rec({ label: 'Orchestrator' }) })
    const whole = owner(t(10), 'complete')
    w.transcript(W, whole + '{"type":"assistant","timestamp":"' + t(11))
    w.transcript(SELF, owner(t(10), 'catch me up'))
    const out = w.run().out
    expect(out).toContain('Owner: complete')
    expect(out).not.toContain('catch me up')
    const pending = JSON.parse(readFileSync(join(w.app, 'catch-up.pending.json'), 'utf8').replace(/^\uFEFF/, ''))
    expect(pending.sessions[W].offset).toBe(Buffer.byteLength(whole))
  })

  it('says so when it is not in a Prism Terminal tab', () => {
    let out = ''
    let code = 0
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, PRISM_SESSIONS_FILE: '' }
      })
    } catch (e) {
      out = (e as { stdout?: string }).stdout ?? ''
      code = (e as { status?: number }).status ?? -1
    }
    expect(code).toBe(2)
    expect(out).toContain('NOT AVAILABLE')
  }, 30_000)

  // The orchestrator's view of the tabs, and one session on its own.
  it('lists the tabs with the orchestrator marked, and digests one session by name', () => {
    const w = world()
    w.sessions({ [W]: rec(), [QUIET]: rec({ label: 'Sonara', cwd: 'C:\\src\\sonara' }) }, [
      { tab: 'a', label: 'Wind', cwd: 'C:\\src\\wind', agent: 'claude', state: 'working', front: false, session: W },
      { tab: 'b', label: 'Lead', cwd: 'C:\\src', agent: 'claude', state: null, front: true, session: null, orchestrator: true }
    ])
    w.transcript(W, owner(t(10), 'wind work'))
    w.transcript(QUIET, owner(t(10), 'sonara work'))
    const list = w.run('-List').out
    expect(list).toContain('- Wind | folder: C:\\src\\wind | now: working | agent: claude')
    expect(list).toMatch(/- Lead .*ORCHESTRATOR/)
    expect(list).toContain(`session ${W} | transcript: `)
    const one = w.run('-Only', 'wind').out
    expect(one).toContain('wind work')
    expect(one).not.toContain('sonara work')
  })

  it('lists a session with nothing new in one line', () => {
    const w = world()
    w.sessions({ [QUIET]: rec({ label: 'Quiet', seen: t(55), lastHookAt: t(50) }) })
    w.transcript(QUIET, owner(t(10), 'x'))
    expect(w.run().out).toContain('Nothing new: Quiet')
  })
})
