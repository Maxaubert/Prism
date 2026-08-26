import type { IPty } from 'node-pty'
import { detectShells, shellById } from './shells'

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

interface Session {
  pty: IPty
  batcher: OutputBatcher
  /** The onData/onExit subscriptions, disposed BEFORE the pty is killed so no
   *  callback can fire into a session that is being torn down. */
  subs: Array<{ dispose(): void }>
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

export function ptyEnv(from: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(from)) {
    if (v === undefined) continue
    const key = k.toUpperCase()
    if (key === 'NO_COLOR') continue
    if (key === 'FORCE_COLOR' && /^(0|false|none)$/i.test(v)) continue
    if (key === 'TERM' || key === 'COLORTERM') continue
    if (SESSION_MARKERS.has(key)) continue
    env[k] = v
  }
  env.TERM = PTY_OPTS.name
  env.COLORTERM = 'truecolor'
  return env
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
  buf: string
  sub: { dispose(): void }
  exited: boolean
}
const warm = new Map<string, WarmShell>()
const rootKey = (root: string): string => root.toLowerCase()

export async function prewarmShell(root: string, shellId: string | undefined): Promise<void> {
  const key = rootKey(root)
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
      w.pty.kill()
    } catch {
      /* already gone */
    }
  }
  try {
    const pty = await import('node-pty')
    const size = desiredSize.get('') ?? { cols: 80, rows: 24 }
    const p = pty.spawn(def.exe, def.args, {
      ...PTY_OPTS,
      cols: size.cols,
      rows: size.rows,
      cwd: root,
      env: ptyEnv(process.env)
    })
    const w: WarmShell = { pty: p, defId: def.id, buf: '', sub: { dispose: () => {} }, exited: false }
    w.sub = p.onData((d) => {
      // The banner and prompt, kept for replay. Capped: a warm shell should
      // be quiet, and a runaway one is not worth adopting anyway.
      if (w.buf.length < 65536) w.buf += d
    })
    p.onExit(() => {
      w.exited = true
      warm.delete(key)
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
      w.pty.kill()
    } catch {
      /* already gone */
    }
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
  if (def.id === 'pwsh' && def.args.length > 0)
    return { exe: def.exe, args: [...def.args.slice(0, -1), `${def.args[def.args.length - 1]}; ${cmd}`] }
  if (def.id === 'powershell') return { exe: def.exe, args: [...def.args, '-NoExit', '-Command', cmd] }
  if (def.id === 'cmd') return { exe: def.exe, args: ['/K', cmd] }
  return { exe: def.exe, args: def.args }
}

export async function spawnTerm(
  id: string,
  root: string,
  shellId: string | undefined,
  send: Send,
  resume?: string
): Promise<boolean> {
  if (sessions.has(id)) return false
  const def = shellById(shellId, await detectShells())
  if (!def) return false
  // Adopt the warm shell when it matches: replay what it printed while
  // waiting (the banner, the prompt), then wire it up like any session.
  // Never for a resume: the warm shell was spawned without the command.
  const w = warm.get(rootKey(root))
  if (!resume && w && !w.exited && w.defId === def.id) {
    warm.delete(rootKey(root))
    w.sub.dispose()
    if (w.buf) send('term:data', id, w.buf)
    const batcher = new OutputBatcher((data) => send('term:data', id, data), 8)
    const subs = [
      w.pty.onData((d) => batcher.push(d)),
      w.pty.onExit(() => {
        batcher.flush()
        sessions.delete(id)
        send('term:exit', id)
      })
    ]
    sessions.set(id, { pty: w.pty, batcher, subs })
    const want = desiredSize.get(id)
    if (want) resizeTerm(id, want.cols, want.rows)
    return true
  }
  try {
    const pty = await import('node-pty')
    const size = desiredSize.get(id) ?? { cols: 80, rows: 24 }
    const launch = resume ? withResume(def, resume) : def
    const p = pty.spawn(launch.exe, launch.args, {
      ...PTY_OPTS,
      cols: size.cols,
      rows: size.rows,
      cwd: root,
      env: ptyEnv(process.env)
    })
    const batcher = new OutputBatcher((data) => send('term:data', id, data), 8)
    const subs = [
      p.onData((d) => batcher.push(d)),
      p.onExit(() => {
        batcher.flush()
        sessions.delete(id)
        send('term:exit', id)
      })
    ]
    sessions.set(id, { pty: p, batcher, subs })
    return true
  } catch {
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
  if (!s) return
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
  try {
    s.pty.kill()
  } catch {
    /* already gone */
  }
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
