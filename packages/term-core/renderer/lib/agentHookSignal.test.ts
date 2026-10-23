import { execFileSync } from 'child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { AGENT_HOOK_EVENTS, failedLabel, parseAgentSignal, STOP_FAILURE_KINDS } from './agentHookSignal'

describe('parseAgentSignal', () => {
  it('reads each state from our plugin', () => {
    expect(parseAgentSignal('prism-agent;state=working')).toEqual({ state: 'working' })
    expect(parseAgentSignal('prism-agent;state=question')).toEqual({ state: 'question' })
    expect(parseAgentSignal('prism-agent;state=done')).toEqual({ state: 'done' })
    expect(parseAgentSignal('prism-agent;state=failed')).toEqual({ state: 'failed' })
    expect(parseAgentSignal('prism-agent;state=failed;kind=rate_limit')).toEqual({ state: 'failed', kind: 'rate_limit' })
  })

  it('refuses an unknown state', () => {
    expect(parseAgentSignal('prism-agent;state=sleeping')).toBeNull()
    expect(parseAgentSignal('prism-agent;state=')).toBeNull()
    expect(parseAgentSignal('prism-agent')).toBeNull()
  })

  it('leaves other OSC 777 users alone', () => {
    expect(parseAgentSignal('notify;Build;done')).toBeNull()
    expect(parseAgentSignal('prism-agentx;state=done')).toBeNull()
    expect(parseAgentSignal('PRISM-AGENT;state=done')).toBeNull()
    expect(parseAgentSignal('')).toBeNull()
  })

  it('refuses a malformed payload or a kind that is not a plain word', () => {
    expect(parseAgentSignal('prism-agent;state')).toBeNull()
    expect(parseAgentSignal('prism-agent;=done')).toBeNull()
    expect(parseAgentSignal('prism-agent;state=failed;kind=<b>x</b>')).toBeNull()
    expect(parseAgentSignal('prism-agent;state=failed;kind=Rate Limit')).toBeNull()
    expect(parseAgentSignal(`prism-agent;state=failed;kind=${'a'.repeat(41)}`)).toBeNull()
    expect(parseAgentSignal(`prism-agent;state=done;${'x'.repeat(300)}`)).toBeNull()
  })

  it('keeps the state when a newer plugin adds a field, and drops a kind on anything but a failure', () => {
    expect(parseAgentSignal('prism-agent;state=done;turn=3')).toEqual({ state: 'done' })
    expect(parseAgentSignal('prism-agent;state=done;kind=rate_limit')).toEqual({ state: 'done' })
  })
})

describe('failedLabel', () => {
  it('names each kind in plain words, and an unknown one by its own', () => {
    expect(failedLabel('rate_limit')).toBe('Failed: rate limit')
    expect(failedLabel('model_not_found')).toBe('Failed: model not found')
    expect(failedLabel('brand_new_error')).toBe('Failed: brand new error')
    expect(failedLabel(undefined)).toBe('Failed')
    for (const k of STOP_FAILURE_KINDS) expect(failedLabel(k)).toMatch(/^Failed: [a-z -]+$/)
  })
})

// THE PLUGIN ITSELF (core/claude-plugin): what Claude Code loads, held to the
// table above. A hook that printed anything else would be dropped by the
// parser, silently, so the files are checked here rather than on a real run.
const PLUGIN = join(__dirname, '..', '..', 'claude-plugin')

describe('the Claude Code plugin', () => {
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks as Record<
    string,
    Array<{ matcher: string; hooks: Array<{ type: string; command: string; args?: string[]; timeout: number }> }>
  >

  it('has a manifest Claude Code accepts', () => {
    const m = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))
    expect(m.name).toMatch(/^[a-z][a-z0-9-]+$/)
    expect(typeof m.description).toBe('string')
  })

  it('hooks exactly the events and matchers of the table, one static command each', () => {
    const found = Object.entries(hooks).flatMap(([event, entries]) =>
      entries.flatMap((e) =>
        e.hooks.map((h) => {
          expect(h.type).toBe('command')
          // Small: blocking events wait for it.
          expect(h.timeout).toBeLessThanOrEqual(10)
          // EXEC FORM, no shell (#131 review): without Git Bash, Claude Code
          // runs a hook's command string through PowerShell, which reads
          // `"path\hook.cmd" working` as a ParserError and shows a hook error
          // on every event (MEASURED on 2.1.289). cmd.exe takes no shell; `call`
          // keeps cmd from stripping the quotes off a folder with brackets in
          // it, and the slash is kept since Claude drops a `\` before the name.
          expect(h.command).toBe('cmd.exe')
          const [d, c, call, script, ...rest] = h.args ?? []
          expect([d, c, call, script]).toEqual(['/d', '/c', 'call', '$' + '{CLAUDE_PLUGIN_ROOT}/hook.cmd'])
          for (const a of rest) expect(a).toMatch(/^[a-z_]+$/)
          return { event, matcher: e.matcher, args: rest.join(' ') }
        })
      )
    )
    const key = (r: { event: string; matcher: string; args: string }): string => `${r.event}|${r.matcher}|${r.args}`
    expect(found.map(key).sort()).toEqual(AGENT_HOOK_EVENTS.map(key).sort())
  })

  it('leaves out SessionStart and SessionEnd, whose bytes rarely reach the pty', () => {
    expect(Object.keys(hooks)).not.toContain('SessionStart')
    expect(Object.keys(hooks)).not.toContain('SessionEnd')
  })

  // cmd is on every Windows machine this runs on, CI's runner included. Each
  // hook is run AS WRITTEN (its command and args, the plugin root put in the
  // way Claude Code does) from a copy in a folder with a space and brackets:
  // `cmd /c "...(x)\hook.cmd"` strips its own quotes there and fails, which
  // `call` is in the args to prevent (MEASURED with Claude Code 2.1.289).
  it.runIf(process.platform === 'win32')('prints valid JSON with the sequence the parser reads, for every hook', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'pt-hooks-')), 'Prism (x) T')
    mkdirSync(root)
    copyFileSync(join(PLUGIN, 'hook.cmd'), join(root, 'hook.cmd'))
    const placeholder = '$' + '{CLAUDE_PLUGIN_ROOT}'
    const all = Object.values(hooks).flatMap((entries) => entries.flatMap((e) => e.hooks))
    for (const h of all) {
      const args = (h.args ?? []).slice(4).join(' ')
      const out = execFileSync(h.command, (h.args ?? []).map((a) => a.replace(placeholder, root)), {
        encoding: 'utf8',
        input: '{"hook_event_name":"Stop"}',
        windowsHide: true
      })
      const seq = JSON.parse(out.trim()).terminalSequence as string
      const open = '\u001b]777;'
      expect(seq.startsWith(open) && seq.endsWith('\u0007'), args).toBe(true)
      const [state, kind] = args.split(' ')
      expect(parseAgentSignal(seq.slice(open.length, -1))).toEqual(kind ? { state, kind } : { state })
    }
  })
})
