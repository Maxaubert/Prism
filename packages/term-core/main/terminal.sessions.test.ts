import { beforeEach, describe, expect, it, vi } from 'vitest'

// The session store against FAKE ptys (code review 2026-09-24, #2 and #12): a
// real node-pty would start real shells. Each fake records whether it was
// killed and lets the test fire its exit.
interface FakePty {
  pid: number
  killed: boolean
  exit: () => void
  kill: () => void
  onData: (cb: (d: string) => void) => { dispose: () => void }
  onExit: (cb: () => void) => { dispose: () => void }
  write: () => void
  resize: () => void
}
const made: FakePty[] = []
let gate: Promise<void> = Promise.resolve()
// A real pty dies on its own thread, some time after kill() returns.
let lateExit = false

vi.mock('node-pty', () => ({
  spawn: () => {
    const exits: Array<() => void> = []
    const p: FakePty = {
      pid: 1000 + made.length,
      killed: false,
      exit: () => exits.forEach((cb) => cb()),
      kill: () => {
        p.killed = true
        if (!lateExit) p.exit()
      },
      onData: () => ({ dispose: () => {} }),
      onExit: (cb) => {
        exits.push(cb)
        return { dispose: () => exits.splice(exits.indexOf(cb), 1) }
      },
      write: () => {},
      resize: () => {}
    }
    made.push(p)
    return p
  }
}))

vi.mock('./shells', () => ({
  // The shell list waits on `gate`, standing in for a cold `where` and `wsl`.
  detectShells: async () => {
    await gate
    return [{ id: 'pwsh', name: 'PowerShell 7', exe: 'pwsh.exe', args: [] }]
  },
  shellById: (_id: unknown, list: Array<{ id: string }>) => list[0]
}))

const { killAll, killTerm, livePids, prewarmShell, shellsGone, spawnTerm } = await import('./terminal')
const send = (): void => {}

beforeEach(() => {
  lateExit = false
  killAll()
  made.length = 0
  gate = Promise.resolve()
})

describe('the quit waits for killed shells to be gone (#127)', () => {
  const settled = async (p: Promise<void>): Promise<boolean> =>
    Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 20))])

  it('resolves at once when nothing was killed', async () => {
    expect(await settled(shellsGone(5000))).toBe(true)
  })

  it('waits until every killed shell has exited', async () => {
    expect(await spawnTerm('q1', 'C:\\x', 'pwsh', send)).toBe(true)
    expect(await spawnTerm('q2', 'C:\\x', 'pwsh', send)).toBe(true)
    lateExit = true
    killAll()
    const gone = shellsGone(5000)
    expect(await settled(gone)).toBe(false)
    made[0].exit()
    expect(await settled(gone)).toBe(false)
    made[1].exit()
    expect(await settled(gone)).toBe(true)
  })

  it('gives up after the timeout when a shell never answers', async () => {
    expect(await spawnTerm('q3', 'C:\\x', 'pwsh', send)).toBe(true)
    lateExit = true
    killAll()
    expect(await settled(shellsGone(5))).toBe(true)
    made[0].exit() // let it go, so the next test starts clean
  })
})

describe('a tab closed while its shell is starting (#12)', () => {
  it('starts no shell, or kills the one that started, and registers nothing', async () => {
    let open!: () => void
    gate = new Promise((r) => (open = r))
    const spawning = spawnTerm('t1', 'C:\\x', 'pwsh', send)
    killTerm('t1') // the tab closes while the shell list is still being read
    open()
    expect(await spawning).toBe(false)
    expect(made.every((p) => p.killed)).toBe(true)
    expect(livePids().some((s) => s.id === 't1')).toBe(false)
  })

  it('a second spawn for the same id while the first is pending is refused', async () => {
    let open!: () => void
    gate = new Promise((r) => (open = r))
    const first = spawnTerm('t2', 'C:\\x', 'pwsh', send)
    const second = spawnTerm('t2', 'C:\\x', 'pwsh', send)
    open()
    expect(await second).toBe(false)
    expect(await first).toBe(true)
    expect(made).toHaveLength(1)
  })
})

describe('the warm shell (#2)', () => {
  it('closing an adopted tab does not drop the NEXT warm shell for that folder', async () => {
    await prewarmShell('C:\\home', 'pwsh') // W1
    expect(await spawnTerm('tab', 'C:\\home', 'pwsh', send)).toBe(true) // adopts W1
    await prewarmShell('C:\\home', 'pwsh') // W2, same key
    expect(made).toHaveLength(2)
    killTerm('tab') // W1 exits; its old warm handler must not remove W2
    // W2 is still there to adopt: the next tab takes it, no third shell.
    expect(await spawnTerm('next', 'C:\\home', 'pwsh', send)).toBe(true)
    expect(made).toHaveLength(2)
    expect(made[1].killed).toBe(false)
  })

  it('a warm shell started with the other plugin answer makes way, and the next tab adopts the new one (#131)', async () => {
    const on = { dir: 'C:\\PT\\claude-plugin', on: true }
    const off = { dir: on.dir, on: false }
    await prewarmShell('C:\\home', 'pwsh', on) // W1, with the plugin
    await prewarmShell('C:\\home', 'pwsh', off) // switched off: W1 goes, W2 comes without
    expect(made).toHaveLength(2)
    expect(made[0].killed).toBe(true)
    expect(await spawnTerm('tab', 'C:\\home', 'pwsh', send, undefined, off)).toBe(true) // adopts W2
    expect(made).toHaveLength(2)
    await prewarmShell('C:\\home', 'pwsh', off) // W3, the same answer
    await prewarmShell('C:\\home', 'pwsh', off) // kept, nothing new
    expect(made).toHaveLength(3)
    expect(made[2].killed).toBe(false)
  })
})
