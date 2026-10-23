import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { OutputBatcher, pluginKey, pollExitCode, ptyEnv, RESUME_ENV, withPluginDir, withResume } from './terminal'
import { isOurPlugin, PLUGIN_NAME } from './claudePlugin'

// Perf review 2026-10-16: a kill whose exit never came polled every 20 ms until the quit.
describe('pollExitCode', () => {
  it('reads every 20 ms for 5 s, then once a second, says so once, and still hears a late exit', () => {
    vi.useFakeTimers()
    try {
      let reads = 0
      const exit: { code?: number } = {}
      const agent = {} as { exitCode?: number }
      Object.defineProperty(agent, 'exitCode', {
        get: () => {
          reads += 1
          return exit.code
        }
      })
      const done = vi.fn()
      const stuck = vi.fn()
      pollExitCode(agent, done, stuck)
      vi.advanceTimersByTime(5000)
      expect(reads).toBe(250)
      expect(stuck).toHaveBeenCalledTimes(1)
      reads = 0
      vi.advanceTimersByTime(60_000)
      expect(reads).toBe(60)
      expect(stuck).toHaveBeenCalledTimes(1)
      exit.code = 1
      vi.advanceTimersByTime(1000)
      expect(done).toHaveBeenCalledTimes(1)
      reads = 0
      vi.advanceTimersByTime(10_000)
      expect(reads).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('OutputBatcher', () => {
  it('coalesces chunks and flushes once per window', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const b = new OutputBatcher((d) => sent.push(d), 8)
    b.push('a')
    b.push('b')
    b.push('c')
    expect(sent).toEqual([]) // nothing yet: batched
    vi.advanceTimersByTime(8)
    expect(sent).toEqual(['abc']) // one message, all the bytes
    b.push('d')
    vi.advanceTimersByTime(8)
    expect(sent).toEqual(['abc', 'd'])
    vi.useRealTimers()
  })

  it('flush() empties immediately, so an exiting shell keeps its last words', () => {
    const sent: string[] = []
    const b = new OutputBatcher((d) => sent.push(d), 8)
    b.push('bye')
    b.flush()
    expect(sent).toEqual(['bye'])
    b.flush() // idempotent: nothing queued, nothing sent
    expect(sent).toEqual(['bye'])
  })
})

describe('ptyEnv', () => {
  it('names the tab for Sonara and never keeps an inherited one (#323)', () => {
    expect(ptyEnv({ PRISM_TAB_ID: 'old', Prism_Tab_Id: 'older' }, 'pwsh', undefined, undefined, 'tok-1')).toMatchObject({
      PRISM_TAB_ID: 'tok-1'
    })
    const env = ptyEnv({ PRISM_TAB_ID: 'old' })
    expect(Object.keys(env).some((k) => k.toUpperCase() === 'PRISM_TAB_ID')).toBe(false)
  })

  it('answers for what the panel can display, not for its launcher', () => {
    const env = ptyEnv({ TERM: 'dumb', COLORTERM: undefined, PATH: 'C:\bin' })
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.PATH).toBe('C:\bin')
  })

  it('drops the variables that would silence colour', () => {
    // The real regression: Prism launched from a shell with NO_COLOR=1 handed
    // it to every agent, and Claude Code went monochrome, logo and all.
    const env = ptyEnv({ NO_COLOR: '1', FORCE_COLOR: '0' })
    expect('NO_COLOR' in env).toBe(false)
    expect('FORCE_COLOR' in env).toBe(false)
  })

  it('keeps a FORCE_COLOR that asks for MORE colour', () => {
    expect(ptyEnv({ FORCE_COLOR: '3' }).FORCE_COLOR).toBe('3')
  })

  it("never passes on another session's identity", () => {
    // Launched from an agent's shell, Prism inherited its markers: every agent
    // in the panel then ran as a CHILD session - no transcript saved (so
    // nothing for Prism's own resume to find) and a live pipe to someone
    // else's conversation.
    const env = ptyEnv({
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: '9fa24458-8fe5-4386-81d3-58cd302bee2d',
      CLAUDE_CODE_MESSAGING_SOCKET: String.raw`\.\pipe\cc-msg-abc`,
      CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
      CODEX_COMPANION_SESSION_ID: 'x',
      PATH: 'C:\bin'
    })
    for (const k of [
      'CLAUDECODE',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CODEX_COMPANION_SESSION_ID'
    ])
      expect(k in env).toBe(false)
    expect(env.PATH).toBe('C:\bin')
  })

  it('keeps the CLAUDE_CODE_* variables that are real configuration', () => {
    const env = ptyEnv({
      CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '500',
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      ANTHROPIC_API_KEY: 'k'
    })
    expect(env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION).toBe('500')
    expect(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1')
    expect(env.ANTHROPIC_API_KEY).toBe('k')
  })

  // #173, then the review of 2026-10-11: supports-hyperlinks reads
  // FORCE_HYPERLINK BEFORE its isTTY test, so set for the whole shell it put
  // raw OSC 8 into every pipe and redirect (`vercel ls > out.txt`, the
  // commands Claude's own Bash tool runs). The app never sets it.
  it('never forces hyperlinks on the programs in a tab', () => {
    expect(Object.keys(ptyEnv({})).some((k) => k.toUpperCase() === 'FORCE_HYPERLINK')).toBe(false)
  })

  it("keeps the user's own FORCE_HYPERLINK, 0 included", () => {
    expect(ptyEnv({ FORCE_HYPERLINK: '0' }).FORCE_HYPERLINK).toBe('0')
  })

  it('writes FORCE_HYPERLINK under no second spelling', () => {
    // Windows names are case-blind: two spellings would be one variable twice.
    const env = ptyEnv({ force_hyperlink: '0' })
    expect(env.force_hyperlink).toBe('0')
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'FORCE_HYPERLINK')).toEqual(['force_hyperlink'])
  })

  it('passes everything else through untouched, undefined aside', () => {
    const env = ptyEnv({ FOO: 'bar', GONE: undefined })
    expect(env.FOO).toBe('bar')
    expect('GONE' in env).toBe(false)
  })
})

// THE CLAUDE CODE PLUGIN (#131): the folder rides CLAUDE_CODE_PLUGIN_DIRS.
describe('ptyEnv and the Claude Code plugin', () => {
  const DIR = 'C:\\PT\\resources\\claude-plugin'
  const on = { dir: DIR, on: true }
  const off = { dir: DIR, on: false }

  it('adds the plugin folder when the setting is on', () => {
    expect(ptyEnv({}, 'pwsh', on).CLAUDE_CODE_PLUGIN_DIRS).toBe(DIR)
  })

  it("keeps the user's own folders and appends ours after them", () => {
    expect(ptyEnv({ CLAUDE_CODE_PLUGIN_DIRS: 'D:\\mine;E:\\too' }, 'pwsh', on).CLAUDE_CODE_PLUGIN_DIRS).toBe(
      `D:\\mine;E:\\too;${DIR}`
    )
  })

  it('writes under the spelling the environment already uses, once', () => {
    const env = ptyEnv({ Claude_Code_Plugin_Dirs: 'D:\\mine' }, 'pwsh', on)
    expect(env.Claude_Code_Plugin_Dirs).toBe(`D:\\mine;${DIR}`)
    expect('CLAUDE_CODE_PLUGIN_DIRS' in env).toBe(false)
  })

  it('does not add it twice', () => {
    expect(ptyEnv({ CLAUDE_CODE_PLUGIN_DIRS: DIR.toLowerCase() }, 'pwsh', on).CLAUDE_CODE_PLUGIN_DIRS).toBe(
      DIR.toLowerCase()
    )
  })

  it("leaves it out when the setting is off, and the user's value as it was", () => {
    expect('CLAUDE_CODE_PLUGIN_DIRS' in ptyEnv({}, 'pwsh', off)).toBe(false)
    expect(ptyEnv({ CLAUDE_CODE_PLUGIN_DIRS: 'D:\\mine' }, 'pwsh', off).CLAUDE_CODE_PLUGIN_DIRS).toBe('D:\\mine')
  })

  it('drops a copy of OUR plugin inherited from another copy of the app, on or off', () => {
    const ours = (d: string): boolean => d.endsWith('stable\\claude-plugin')
    const from = { CLAUDE_CODE_PLUGIN_DIRS: 'D:\\mine;C:\\stable\\claude-plugin' }
    expect(ptyEnv(from, 'pwsh', on, ours).CLAUDE_CODE_PLUGIN_DIRS).toBe(`D:\\mine;${DIR}`)
    expect(ptyEnv(from, 'pwsh', off, ours).CLAUDE_CODE_PLUGIN_DIRS).toBe('D:\\mine')
    expect('CLAUDE_CODE_PLUGIN_DIRS' in ptyEnv({ CLAUDE_CODE_PLUGIN_DIRS: 'C:\\stable\\claude-plugin' }, 'pwsh', off, ours)).toBe(false)
  })

  it('changes nothing for a host that ships no plugin (Prism), whatever is inherited', () => {
    const from = { CLAUDE_CODE_PLUGIN_DIRS: 'D:\\mine;;C:\\stable\\claude-plugin', FOO: 'x' }
    expect(ptyEnv(from, 'pwsh', undefined, () => true)).toEqual(ptyEnv(from, 'pwsh'))
    expect(ptyEnv(from, 'pwsh').CLAUDE_CODE_PLUGIN_DIRS).toBe(from.CLAUDE_CODE_PLUGIN_DIRS)
    expect('CLAUDE_CODE_PLUGIN_DIRS' in ptyEnv({}, 'pwsh')).toBe(false)
  })

  it('keys a warm shell by what it was started with', () => {
    expect(pluginKey(undefined)).toBe('')
    expect(pluginKey(on)).not.toBe(pluginKey(off))
    expect(pluginKey(on)).toBe(pluginKey({ ...on }))
  })

  it('withPluginDir drops empty entries', () => {
    expect(withPluginDir(';a;;', 'b')).toBe('a;b')
    expect(withPluginDir(undefined, undefined)).toBe('')
  })
})

describe('isOurPlugin', () => {
  it('knows our plugin by its manifest name, and nothing else', () => {
    const base = mkdtempSync(join(tmpdir(), 'pt-plugin-'))
    const mk = (name: string, manifest: string | null): string => {
      const d = join(base, name)
      mkdirSync(join(d, '.claude-plugin'), { recursive: true })
      if (manifest !== null) writeFileSync(join(d, '.claude-plugin', 'plugin.json'), manifest)
      return d
    }
    expect(isOurPlugin(mk('ours', JSON.stringify({ name: PLUGIN_NAME })))).toBe(true)
    expect(isOurPlugin(mk('theirs', JSON.stringify({ name: 'something-else' })))).toBe(false)
    expect(isOurPlugin(mk('broken', '{'))).toBe(false)
    expect(isOurPlugin(mk('empty', null))).toBe(false)
    expect(isOurPlugin(join(base, 'missing'))).toBe(false)
  })

  it('names the plugin the app ships', () => {
    expect(isOurPlugin(join(__dirname, '..', 'claude-plugin'))).toBe(true)
  })
})

describe('withResume', () => {
  // THE COMMAND LINE IS THE SAME FOR EVERY RESTORED SHELL (#180). Windows
  // Defender judges each NEW command line a process starts, inside
  // CreateProcess, and node-pty runs that on main's thread: measured from the
  // packaged app, 700 ms per new command line and 3 ms per repeated one, so
  // eight resumes with the id in their command lines held main for 5.6 s. The
  // id rides in the environment instead.
  const pwsh = { id: 'pwsh', exe: 'pwsh.exe', args: ['-NoLogo', '-NoExit', '-Command', 'boot'] }
  const powershell = { id: 'powershell', exe: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', 'boot'] }
  const cmd = { id: 'cmd', exe: 'cmd.exe', args: [] }
  const a = '5a1d0c2e-1111-4222-8333-94445555a666'
  const b = '0f0e0d0c-2222-4333-8444-955566667777'

  it('starts two claude resumes with the same command line, the id in the environment', () => {
    for (const def of [pwsh, powershell, cmd]) {
      const one = withResume(def, a)
      const two = withResume(def, b)
      expect(one.args).toEqual(two.args)
      expect(one.args.join(' ')).not.toContain(a)
      expect(one.env).toEqual({ [RESUME_ENV]: a })
      expect(two.env).toEqual({ [RESUME_ENV]: b })
    }
  })

  it('appends the resume to the PowerShell bootstrap, and clears the variable before claude starts', () => {
    const r = withResume(pwsh, a)
    expect(r.exe).toBe('pwsh.exe')
    expect(r.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-Command'])
    expect(r.args[3]).toBe(`boot; & { $r = $env:${RESUME_ENV}; Remove-Item Env:${RESUME_ENV}; claude --resume $r }`)
  })

  it('gives cmd its startup command, with no quote for the command line to mangle', () => {
    const r = withResume(cmd, a)
    expect(r.args).toEqual(['/K', `set ${RESUME_ENV}=& claude --resume %${RESUME_ENV}%`])
    expect(r.args[1]).not.toContain('"')
  })

  it('leaves codex as it was: its resume has no id, so its command line never varies', () => {
    expect(withResume(pwsh, 'codex:last')).toEqual({ exe: 'pwsh.exe', args: ['-NoLogo', '-NoExit', '-Command', 'boot; codex resume --last'] })
    expect(withResume(cmd, 'codex:last')).toEqual({ exe: 'cmd.exe', args: ['/K', 'codex resume --last'] })
  })

  it('leaves a shell with no startup-command form alone', () => {
    const wsl = { id: 'wsl:Ubuntu', exe: 'wsl.exe', args: ['-d', 'Ubuntu'] }
    expect(withResume(wsl, a)).toEqual({ exe: 'wsl.exe', args: ['-d', 'Ubuntu'] })
  })
})
