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
}

const sessions = new Map<string, Session>()

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
export async function spawnTerm(id: string, root: string, shellId: string | undefined, send: Send): Promise<boolean> {
  if (sessions.has(id)) return false
  const def = shellById(shellId, await detectShells())
  if (!def) return false
  try {
    const pty = await import('node-pty')
    const size = desiredSize.get(id) ?? { cols: 80, rows: 24 }
    const p = pty.spawn(def.exe, def.args, {
      name: 'xterm-color',
      cols: size.cols,
      rows: size.rows,
      cwd: root,
      env: process.env as Record<string, string>,
      useConpty: true
    })
    const batcher = new OutputBatcher((data) => send('term:data', id, data), 8)
    p.onData((d) => batcher.push(d))
    p.onExit(() => {
      batcher.flush()
      sessions.delete(id)
      send('term:exit', id)
    })
    sessions.set(id, { pty: p, batcher })
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

/** Quit: every shell dies with the app. */
export function killAll(): void {
  for (const id of [...sessions.keys()]) killTerm(id)
}
