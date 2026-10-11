import type { IPty } from 'node-pty'
import { cdCommand } from '../shared/termCwd'
import { detectShells, shellById } from './shells'
import { cmdPrompt } from './termPrompt'
import { isOurPlugin } from './claudePlugin'
import { diagMain } from './diagLog'

// The pty host. Sessions are keyed by an id the renderer assigns - the same
// pattern as tabs, where the renderer owns the list and main owns the
// resources. Main only ever spawns shells shells.ts detected; a renderer-
// supplied shell id is a lookup, never a path.

/**
 * Coalesce pty output into one IPC message per window. A `type` of a large
 * file emits thousands of tiny chunks, and each would otherwise be its own
 * cross-process message; 8ms batches them below anyone's perception.
 */
export class OutputBatcher {
  private buf = ''
  private timer: NodeJS.Timeout | null = null
  constructor(
    private readonly send: (data: string) => void,
    private readonly ms: number
  ) {}

  push(data: string): void {
    this.buf += data
    this.timer ??= setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.ms)
  }

  /** Empty now. Used on exit so the shell's last words are not left queued. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.buf) return
    const out = this.buf
    this.buf = ''
    this.send(out)
  }
}

/**
 * How much has come out of any shell (2026-08-28).
 *
 * A bare counter, bumped on every chunk. The agent poll reads it to decide
 * whether anything COULD have changed: a shell that has printed nothing since
 * the last look cannot have started or finished an agent, so there is nothing
 * to go looking for. It is a number rather than a timestamp so it cannot be
 * confused by a clock, and it only ever goes up.
 */
let outputTicks = 0

export function ptyOutputTicks(): number {
  return outputTicks
}

interface Session {
  pty: IPty
  batcher: OutputBatcher
  /** The onData/onExit subscriptions, disposed BEFORE the pty is killed so no
   *  callback can fire into a session that is being torn down. */
  subs: Array<{ dispose(): void }>
  /** Which shell this is, for the one line Prism may write into it (#99). */
  defId: string
}

/**
 * ConPTY teardown on the OS conhost can FAST-FAIL the whole process
 * (0xc0000409) when a pty is killed mid-read - it took Prism down with it,
 * no dialog, no ask (crashed 2026-08-21, same fault offset across four WER
 * reports). node-pty ships its own conpty.dll with the fix; using it is the
 * documented cure, and Windows 10 1809+ (our floor) is its requirement.
 */
// xterm-256color, not xterm-color: `supports-color` and everything built on
// it (Ink, chalk - so Claude Code and codex) read TERM to decide how much
// colour they may use, and "xterm-color" caps them at 16.
const PTY_OPTS = { name: 'xterm-256color', useConpty: true, useConptyDll: true } as const

/**
 * The environment a shell in Prism's panel should see.
 *
 * NOT the app's own environment verbatim: Prism inherits whatever launched it,
 * and a launcher that suppresses colour (NO_COLOR, FORCE_COLOR=0 - both
 * ordinary in a script or an agent's shell) made every agent inside the panel
 * render in monochrome, logo and all. A terminal emulator answers for what IT
 * can display, which is 24-bit colour, so it says so and drops the two
 * variables that would claim otherwise.
 */
/**
 * The markers an AI CLI leaves in the environment of everything it spawns, so
 * a nested one knows it is a CHILD: it stops saving a transcript, and it can
 * be handed its parent's session id and message pipe.
 *
 * Prism must not pass those on. Launched FROM an agent's shell (which is how
 * it gets installed and started here), every agent in the panel became a
 * child of that session: no transcript - so nothing for Prism's own resume to
 * come back to - and a live socket to somebody else's conversation. A shell
 * in the panel is a top-level shell, whatever started the app.
 *
 * Names only, deliberately: `CLAUDE_CODE_*` also carries real configuration
 * (web-search limits, feature flags) that the user meant to set.
 */
const SESSION_MARKERS = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_PID',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_EFFORT',
  'CODEX_COMPANION_SESSION_ID',
  'CODEX_COMPANION_TRANSCRIPT_PATH'
])

/**
 * THE CLAUDE CODE PLUGIN (#131): Claude loads every folder named in this
 * variable as a plugin (2.1.280+, MEASURED on 2.1.289, `;` between several),
 * so a plain `claude` typed in the tab reports its state with nothing written
 * to the user's own settings. The user's own value is KEPT and ours appended.
 */
const PLUGIN_DIRS = 'CLAUDE_CODE_PLUGIN_DIRS'

/**
 * What a host that ships the plugin says about a shell: where its plugin is,
 * and whether the setting is on. A host that ships none (Prism, until it does)
 * passes nothing, and the variable is left exactly as inherited.
 */
export interface ClaudePluginEnv {
  dir: string
  on: boolean
}

/** Which warm shell a spawn may adopt: one started with the same answer. */
export const pluginKey = (p: ClaudePluginEnv | undefined): string =>
  p ? `${p.on ? 1 : 0}|${p.dir}` : ''

/**
 * The user's plugin folders, with ours appended when `dir` is given. Any copy
 * of OUR plugin the app inherited (`isOurs`, see claudePlugin.ts: launched
 * from another copy's tab) is dropped first, so a Claude never runs two and
 * "off" leaves none. Empty: the variable goes.
 */
export function withPluginDir(
  dirs: string | undefined,
  dir: string | undefined,
  isOurs: (d: string) => boolean = () => false
): string {
  const list = (dirs ?? '').split(';').filter((d) => d.trim() && !isOurs(d))
  if (dir && !list.some((d) => d.trim().toLowerCase() === dir.toLowerCase())) list.push(dir)
  return list.join(';')
}

export function ptyEnv(
  from: NodeJS.ProcessEnv,
  shellId?: string,
  plugin?: ClaudePluginEnv,
  isOurs?: (d: string) => boolean
): Record<string, string> {
  const env: Record<string, string> = {}
  let prompt: string | undefined
  for (const [k, v] of Object.entries(from)) {
    if (v === undefined) continue
    const key = k.toUpperCase()
    if (key === 'NO_COLOR') continue
    if (key === 'FORCE_COLOR' && /^(0|false|none)$/i.test(v)) continue
    if (key === 'TERM' || key === 'COLORTERM') continue
    if (SESSION_MARKERS.has(key)) continue
    if (key === 'PROMPT') prompt = v
    env[k] = v
  }
  env.TERM = PTY_OPTS.name
  env.COLORTERM = 'truecolor'
  // NO FORCE_HYPERLINK (#173 set it; review 2026-10-11 took it out). Claude
  // Code prints OSC 8 links only when told (MEASURED 2.1.296: "label (long
  // url)" without it), but supports-hyperlinks, which it and the vercel CLI
  // bundle, reads FORCE_HYPERLINK BEFORE its isTTY test (read in claude.exe:
  // `if(e)return!(...)` ahead of `if(r&&!r.isTTY)return!1`), so set for the
  // shell it put raw OSC 8 into every pipe and redirect, the commands
  // Claude's own Bash tool runs among them. The panel still opens any OSC 8
  // link a program prints (#169); Claude's `hyperlinks` setting turns them on.
  // A user's own FORCE_HYPERLINK passes through like any other variable.
  // cmd reports its folder through PROMPT (#99), in front of whatever prompt
  // the user already had.
  if (shellId === 'cmd') env.PROMPT = cmdPrompt(prompt)
  // Windows names are case-blind: write under the spelling already there.
  const key = Object.keys(env).find((k) => k.toUpperCase() === PLUGIN_DIRS) ?? PLUGIN_DIRS
  if (plugin) {
    const dirs = withPluginDir(env[key], plugin.on ? plugin.dir : undefined, isOurs)
    if (dirs) env[key] = dirs
    else delete env[key]
  }
  return env
}

/**
 * Move a shell to `path` (#99): the SECOND command Prism ever writes itself,
 * beside the agent resume (owner decision, 2026-09-04). Composed here, next to
 * the first one, from the shell id main spawned - never from text the
 * renderer sends. The renderer holds the guard (idle prompt, nothing typed,
 * no agent); main only knows how to say it in the shell's own language.
 * False when there is no session or no way to say it (WSL).
 */
export function cdTerm(id: string, path: string): boolean {
  const s = sessions.get(id)
  if (!s) return false
  const line = cdCommand(s.defId, path)
  if (!line) return false
  s.pty.write(line)
  return true
}

const sessions = new Map<string, Session>()

/**
 * Warm shells, one per recently-active root (two at most). Opening a terminal
 * used to pay the whole bill at the click - chunk, pty, pwsh startup, the
 * PSReadLine bootstrap - about a second of it. Now the shell for the active
 * tab is started AHEAD of the click; term:spawn adopts it and replays the
 * banner it buffered, so the prompt is simply there.
 */
interface WarmShell {
  pty: IPty
  defId: string
  /** `pluginKey` of what it was started with (#131): adopted only by a spawn
   *  that wants the same, so a switched-off setting is never handed a shell
   *  that still carries the plugin. */
  plugin: string
  buf: string
  sub: { dispose(): void }
  exited: boolean
}
const warm = new Map<string, WarmShell>()
const rootKey = (root: string): string => root.toLowerCase()

/**
 * Every shell we end, until node-pty has said it is gone (#127). Its exit
 * watcher is a native thread that calls back into JavaScript; when the app
 * quit first, the call landed while Node was tearing its environment down,
 * threw, and Electron aborted (0xc0000409, no dialog). MEASURED in a WER dump,
 * 2026-10-04: node::FreeEnvironment -> CleanupHandles -> ThreadSafeFunction::
 * CallJS -> Napi::Error -> abort, about one quit in four with ten shells open.
 * So a kill is remembered here and the quit waits (`shellsGone`).
 */
const dying = new Set<Promise<void>>()
function killPty(p: IPty): void {
  const gone = new Promise<void>((resolve) => {
    let poll: ReturnType<typeof setInterval> | undefined
    const done = (): void => {
      if (poll) clearInterval(poll)
      resolve()
    }
    try {
      p.onExit(done)
    } catch {
      done()
      return
    }
    // The exit EVENT waits for the output pipe to close: 1.0 to 2.7 s for a
    // pwsh killed while it starts, which is what a warm shell is at quit
    // (MEASURED). What the quit must outlive is only the native callback, and
    // that sets the Windows agent's exitCode the moment it runs. Read it where
    // node-pty has it; the event stands for everything else.
    const agent = (p as unknown as { _agent?: { exitCode?: number } })._agent
    if (agent && 'exitCode' in agent) {
      poll = setInterval(() => {
        if (agent.exitCode !== undefined) done()
      }, 20)
    }
  })
  dying.add(gone)
  void gone.then(() => dying.delete(gone))
  try {
    p.kill()
  } catch {
    /* already gone */
  }
}

/** How many shells we killed that have not exited yet. */
export function shellsDying(): number {
  return dying.size
}

/** Resolves once every shell we killed has exited, or after `timeoutMs`. */
export function shellsGone(timeoutMs: number): Promise<void> {
  if (!dying.size) return Promise.resolve()
  return Promise.race([
    Promise.all([...dying]).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ])
}

export async function prewarmShell(
  root: string,
  shellId: string | undefined,
  plugin?: ClaudePluginEnv
): Promise<void> {
  const key = rootKey(root)
  // A warm shell started with the other plugin answer (#131 review) is never
  // adopted, and it sat in this slot for good: every later tab in the folder
  // started cold once the setting was switched. It makes way for one that
  // matches what the next spawn will ask.
  const held = warm.get(key)
  if (held && held.plugin !== pluginKey(plugin)) killWarm(root)
  if (warm.has(key)) return
  const def = shellById(shellId, await detectShells())
  if (!def) return
  if (warm.has(key)) return // a second call raced the await
  // Two warm shells at most: evict the other root's.
  for (const [k, w] of warm) {
    if (warm.size < 2) break
    warm.delete(k)
    try {
      w.sub.dispose()
    } catch {
      /* already gone */
    }
    if (!w.exited) killPty(w.pty)
  }
  try {
    const pty = await import('node-pty')
    const size = desiredSize.get('') ?? { cols: 80, rows: 24 }
    const p = pty.spawn(def.exe, def.args, {
      ...PTY_OPTS,
      cols: size.cols,
      rows: size.rows,
      cwd: root,
      env: ptyEnv(process.env, def.id, plugin, isOurPlugin)
    })
    const w: WarmShell = { pty: p, defId: def.id, plugin: pluginKey(plugin), buf: '', sub: { dispose: () => {} }, exited: false }
    w.sub = p.onData((d) => {
      // The banner and prompt, kept for replay. Capped: a warm shell should
      // be quiet, and a runaway one is not worth adopting anyway.
      if (w.buf.length < 65536) w.buf += d
    })
    p.onExit(() => {
      w.exited = true
      // Only THIS warm shell's entry (code review 2026-09-24, #2). Once it is
      // adopted as a tab, the same folder is warmed again under the same key;
      // this handler outlives the adoption and ran when the TAB closed,
      // deleting the NEW warm shell without killing it: a hidden shell per
      // open-and-close, out of reach of killWarm and killAll.
      if (warm.get(key) === w) warm.delete(key)
    })
    warm.set(key, w)
  } catch {
    /* prewarm is best-effort; the click path still works cold */
  }
}

function killWarm(root?: string): void {
  for (const [k, w] of warm) {
    if (root !== undefined && k !== rootKey(root)) continue
    warm.delete(k)
    try {
      w.sub.dispose()
    } catch {
      /* already gone */
    }
    if (!w.exited) killPty(w.pty)
  }
}
export { killWarm }

// The size each session SHOULD be, remembered even before its shell exists.
// The renderer's first fit can land while the spawn is still resolving (cold
// first runs take seconds), and a dropped first resize left the pty at 80x24
// inside a maximized window - Ink UIs then draw a tiny layout mid-screen and
// nothing ever corrects it, because a static window fires no further resizes.
const desiredSize = new Map<string, { cols: number; rows: number }>()

type Send = (channel: string, ...args: unknown[]) => void

/**
 * Spawn a shell for `id`, cwd at `root`. Refuses a live id (the renderer asked
 * twice; the first shell wins). node-pty is imported here rather than at module
 * top so the resident window's launch path never touches the native module.
 */
/**
 * A restored Claude session rides the shell's OWN startup command, so nothing
 * is ever visibly typed: claude appears the way a banner does. Claude resumes
 * by SESSION ID (main resolved it from claude's store; the bare --continue
 * guessed and missed). pwsh appends to its bootstrap; the others get their
 * native startup-command forms. WSL is left alone - claude-in-WSL is another
 * world's store.
 */
function withResume(def: { exe: string; args: string[]; id: string }, resume: string): { exe: string; args: string[] } {
  // The ONE place Prism writes a command itself (the owner exception, 2026-08-21,
  // now covering codex too): claude comes back by session id, codex by its own
  // cwd-filtered --last. Never typed on screen, never a guess.
  const cmd = resume === 'codex:last' ? 'codex resume --last' : `claude --resume ${resume}`
  // Both PowerShells end their args in a `-Command` bootstrap now (the prompt
  // hook, #99), so the resume is appended to it for either.
  if ((def.id === 'pwsh' || def.id === 'powershell') && def.args.length > 0)
    return { exe: def.exe, args: [...def.args.slice(0, -1), `${def.args[def.args.length - 1]}; ${cmd}`] }
  if (def.id === 'cmd') return { exe: def.exe, args: ['/K', cmd] }
  return { exe: def.exe, args: def.args }
}

/**
 * SPAWNS IN FLIGHT (code review 2026-09-24, #12). A spawn awaits the shell
 * list (a cold `where` and `wsl -l` at launch) and node-pty before the session
 * exists, so a tab closed meanwhile sent a kill that found nothing, and the
 * shell, maybe a resumed Claude, then started for a tab that was gone and ran
 * hidden until quit. A second spawn for the same id passed the has() check
 * too and orphaned the first. Now an id is PENDING from the first line, a
 * second spawn for it is refused, and a kill that arrives while it is pending
 * is remembered and carried out the moment the pty exists.
 */
const pending = new Set<string>()
const killedWhilePending = new Set<string>()

/** A shell's birth and end on the diagnostics timeline (#140). Never throws. */
function shellCrumb(a: string, fields: Record<string, unknown>): void {
  try {
    diagMain().write('main', 'crumb', { a, ...fields })
  } catch {
    /* the log never breaks a spawn */
  }
}

export async function spawnTerm(
  id: string,
  root: string,
  shellId: string | undefined,
  send: Send,
  resume?: string,
  plugin?: ClaudePluginEnv
): Promise<boolean> {
  if (sessions.has(id) || pending.has(id)) return false
  pending.add(id)
  try {
    return await spawnPending(id, root, shellId, send, resume, plugin)
  } finally {
    pending.delete(id)
    killedWhilePending.delete(id)
  }
}

async function spawnPending(
  id: string,
  root: string,
  shellId: string | undefined,
  send: Send,
  resume: string | undefined,
  plugin: ClaudePluginEnv | undefined
): Promise<boolean> {
  const def = shellById(shellId, await detectShells())
  if (!def) return false
  // Closed while the shell list was being read: start nothing.
  if (killedWhilePending.has(id)) return false
  // Adopt the warm shell when it matches: replay what it printed while
  // waiting (the banner, the prompt), then wire it up like any session.
  // Never for a resume: the warm shell was spawned without the command.
  const w = warm.get(rootKey(root))
  if (!resume && w && !w.exited && w.defId === def.id && w.plugin === pluginKey(plugin)) {
    warm.delete(rootKey(root))
    w.sub.dispose()
    if (w.buf) send('term:data', id, w.buf)
    const batcher = new OutputBatcher((data) => send('term:data', id, data), 8)
    const subs = [
      w.pty.onData((d) => {
        outputTicks += 1
        batcher.push(d)
      }),
      w.pty.onExit((e) => {
        batcher.flush()
        sessions.delete(id)
        shellCrumb('shell-exit', { id, pid: w.pty.pid, exitCode: e?.exitCode ?? null })
        send('term:exit', id)
      })
    ]
    sessions.set(id, { pty: w.pty, batcher, subs, defId: w.defId })
    shellCrumb('shell-spawn', { id, pid: w.pty.pid, shell: def.id, warm: true })
    const want = desiredSize.get(id)
    if (want) resizeTerm(id, want.cols, want.rows)
    return true
  }
  const t0 = performance.now()
  try {
    const pty = await import('node-pty')
    const size = desiredSize.get(id) ?? { cols: 80, rows: 24 }
    const launch = resume ? withResume(def, resume) : def
    const p = pty.spawn(launch.exe, launch.args, {
      ...PTY_OPTS,
      cols: size.cols,
      rows: size.rows,
      cwd: root,
      env: ptyEnv(process.env, def.id, plugin, isOurPlugin)
    })
    // Closed while node-pty loaded: the tab is gone, so is this shell.
    if (killedWhilePending.has(id)) {
      killPty(p)
      return false
    }
    const batcher = new OutputBatcher((data) => send('term:data', id, data), 8)
    const subs = [
      p.onData((d) => {
        outputTicks += 1
        batcher.push(d)
      }),
      p.onExit((e) => {
        batcher.flush()
        sessions.delete(id)
        shellCrumb('shell-exit', { id, pid: p.pid, exitCode: e?.exitCode ?? null })
        send('term:exit', id)
      })
    ]
    sessions.set(id, { pty: p, batcher, subs, defId: def.id })
    shellCrumb('shell-spawn', { id, pid: p.pid, shell: def.id, cwd: root, resume: !!resume, ms: Math.round(performance.now() - t0) })
    return true
  } catch (err) {
    shellCrumb('shell-spawn-failed', { id, shell: def.id, cwd: root, err: err instanceof Error ? err.message : String(err) })
    return false // shell missing or ConPTY refused; the renderer shows the line
  }
}

export function writeTerm(id: string, data: string): void {
  sessions.get(id)?.pty.write(data)
}

export function resizeTerm(id: string, cols: number, rows: number, attempt = 0): void {
  if (cols < 2 || rows < 1 || !Number.isInteger(cols) || !Number.isInteger(rows)) return
  desiredSize.set(id, { cols, rows })
  const s = sessions.get(id)
  if (!s) return // spawn in flight: it will be born at desiredSize
  try {
    s.pty.resize(cols, rows)
  } catch {
    // ConPTY can transiently refuse (heavy output mid-resize). A swallowed
    // FINAL resize is how a layout stays wrong until the user jiggles the
    // window, so retry while this is still the wanted size.
    if (attempt < 5)
      setTimeout(() => {
        const want = desiredSize.get(id)
        if (want && want.cols === cols && want.rows === rows) resizeTerm(id, cols, rows, attempt + 1)
      }, 300)
  }
}

export function killTerm(id: string): void {
  desiredSize.delete(id)
  const s = sessions.get(id)
  if (!s) {
    // Its shell is still starting: kill it the moment it exists (#12).
    if (pending.has(id)) killedWhilePending.add(id)
    return
  }
  sessions.delete(id) // first, so the exit handler's delete is a no-op
  // Handlers off before the kill: this teardown is ours, nothing should hear
  // the pty's death throes or write into them.
  for (const sub of s.subs) {
    try {
      sub.dispose()
    } catch {
      /* already gone */
    }
  }
  // No flush: this death is ours (tab close, quit), nobody is listening, and
  // at quit the webContents a flush would send into may already be gone.
  killPty(s.pty)
}

/** The live sessions' shell pids, for the agent poll. */
export function livePids(): Array<{ id: string; pid: number }> {
  return [...sessions.entries()].map(([id, s]) => ({ id, pid: s.pty.pid }))
}

/** Quit: every shell dies with the app, warm spares included. */
export function killAll(): void {
  killWarm()
  for (const id of [...sessions.keys()]) killTerm(id)
}
