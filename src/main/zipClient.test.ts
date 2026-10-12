import AdmZip from 'adm-zip'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteMember, listArchive, renameMember, setZipFork } from './archive'
import { createZipClient, type ZipProc } from './zipClient'
import { runZipJob, type ZipReply, type ZipRequest } from './zipOps'

// main's side of the zip worker (owner, 2026-10-12, zip work off the main
// process): one writer per file, errors unchanged, a dead worker rejects what
// it held, an idle one is killed.

/** A worker the test answers by hand. */
class FakeProc implements ZipProc {
  posted: ZipRequest[] = []
  killed = false
  private onMessage: Array<(m: ZipReply) => void> = []
  private onExit: Array<(c: number) => void> = []
  postMessage(m: ZipRequest): void {
    this.posted.push(m)
  }
  on(event: 'message' | 'exit', fn: ((m: ZipReply) => void) | ((c: number) => void)): this {
    if (event === 'message') this.onMessage.push(fn as (m: ZipReply) => void)
    else this.onExit.push(fn as (c: number) => void)
    return this
  }
  kill(): boolean {
    this.killed = true
    this.exit(0)
    return true
  }
  answer(id: number, result: unknown): void {
    for (const fn of this.onMessage) fn({ id, ok: true, result })
  }
  fail(id: number, error: string): void {
    for (const fn of this.onMessage) fn({ id, ok: false, error })
  }
  exit(code = 1): void {
    for (const fn of this.onExit) fn(code)
  }
}

/** A worker that runs the real zipOps in this process, like the real one. */
class InProcess extends FakeProc {
  postMessage(m: ZipRequest): void {
    super.postMessage(m)
    void runZipJob(m).then((r) => (r.ok ? this.answer(r.id, r.result) : this.fail(r.id, r.error)))
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

afterEach(() => {
  vi.useRealTimers()
})

describe('archive.ts through the worker', () => {
  it('renames, deletes and lists via the worker, with the old results', async () => {
    const procs: InProcess[] = []
    setZipFork(() => {
      const p = new InProcess()
      procs.push(p)
      return p
    })
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('hello'))
    zip.addFile('docs/guide.md', Buffer.from('# guide'))
    const zipPath = join(mkdtempSync(join(tmpdir(), 'prism-client-')), 'a.zip')
    zip.writeZip(zipPath)
    // Asked for together, answered in order: the list sees both edits.
    const renamed = renameMember(zipPath, 'docs/guide.md', 'manual.md')
    const deleted = deleteMember(zipPath, 'readme.txt')
    const listed = listArchive(zipPath)
    expect(await renamed).toBe('ok')
    expect(await deleted).toBe(true)
    expect((await listed).map((e) => e.path).sort()).toEqual(['docs', 'docs/manual.md'])
    expect(procs).toHaveLength(1)
    // A bad name is refused on main, without a trip to the worker.
    expect(await renameMember(zipPath, 'docs/manual.md', 'a/b')).toBe('failed')
  })
})

describe('createZipClient', () => {
  function setup(idleMs = 60_000): {
    client: ReturnType<typeof createZipClient>
    procs: FakeProc[]
  } {
    const procs: FakeProc[] = []
    const client = createZipClient({
      fork: () => {
        const p = new FakeProc()
        procs.push(p)
        return p
      },
      seven: () => 'C:\\7z.exe',
      idleMs
    })
    return { client, procs }
  }

  it('runs edits of one archive one at a time, in the order asked', async () => {
    const { client, procs } = setup()
    const first = client.edit('deleteMember', 'C:\\z\\a.zip', 'x')
    const second = client.edit('deleteMember', 'c:/z/A.zip', 'y') // same file, other spelling
    await tick()
    expect(procs[0].posted.map((m) => m.args[1])).toEqual(['x'])
    expect(procs[0].posted[0].seven).toBe('C:\\7z.exe')
    procs[0].answer(procs[0].posted[0].id, true)
    expect(await first).toBe(true)
    await tick()
    expect(procs[0].posted.map((m) => m.args[1])).toEqual(['x', 'y'])
    procs[0].answer(procs[0].posted[1].id, false)
    expect(await second).toBe(false)
  })

  it('lets an edit of ANOTHER archive go ahead, and holds a read behind its own', async () => {
    const { client, procs } = setup()
    void client.edit('deleteMember', 'C:\\a.zip', 'x')
    void client.edit('deleteMember', 'C:\\b.zip', 'y')
    const read = client.read('listArchive', 'C:\\a.zip')
    await tick()
    expect(procs[0].posted.map((m) => m.args[0])).toEqual(['C:\\a.zip', 'C:\\b.zip'])
    procs[0].answer(procs[0].posted[0].id, true)
    await tick()
    expect(procs[0].posted.map((m) => m.op)).toEqual([
      'deleteMember',
      'deleteMember',
      'listArchive'
    ])
    procs[0].answer(procs[0].posted[2].id, [])
    expect(await read).toEqual([])
  })

  it('a failed edit does not stop the next one, and keeps its message', async () => {
    const { client, procs } = setup()
    const first = client.edit('moveMembers', 'C:\\a.zip', ['x'], '')
    const second = client.edit('moveMembers', 'C:\\a.zip', ['y'], '')
    await tick()
    procs[0].fail(procs[0].posted[0].id, 'EBUSY: resource busy or locked')
    await expect(first).rejects.toThrow('EBUSY: resource busy or locked')
    await tick()
    procs[0].answer(procs[0].posted[1].id, 'ok')
    expect(await second).toBe('ok')
  })

  it('a worker that exits rejects what it held, and the next job forks a fresh one', async () => {
    const { client, procs } = setup()
    const a = client.read('listArchive', 'C:\\a.zip')
    const b = client.read('archiveStat', 'C:\\b.zip')
    await tick()
    expect(client.pending()).toBe(2)
    procs[0].exit(1)
    await expect(a).rejects.toThrow('zip worker exited')
    await expect(b).rejects.toThrow('zip worker exited')
    expect(client.pending()).toBe(0)
    const c = client.read('hasEncrypted', 'C:\\a.zip')
    await tick()
    expect(procs).toHaveLength(2)
    procs[1].answer(procs[1].posted[0].id, false)
    expect(await c).toBe(false)
  })

  it('kills an idle worker after the wait, never a busy one', async () => {
    vi.useFakeTimers()
    const { client, procs } = setup(1000)
    const a = client.read('listArchive', 'C:\\a.zip')
    await vi.advanceTimersByTimeAsync(0)
    procs[0].answer(procs[0].posted[0].id, [])
    await a
    // Busy again before the wait is over: the timer starts over and waits.
    const b = client.read('listArchive', 'C:\\a.zip')
    await vi.advanceTimersByTimeAsync(999)
    expect(procs[0].killed).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(procs[0].killed).toBe(false) // a job is still out
    procs[0].answer(procs[0].posted[1].id, [])
    await b
    await vi.advanceTimersByTimeAsync(999)
    expect(procs[0].killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(procs[0].killed).toBe(true)
    // And comes back on demand.
    const c = client.read('listArchive', 'C:\\a.zip')
    await vi.advanceTimersByTimeAsync(0)
    expect(procs).toHaveLength(2)
    procs[1].answer(procs[1].posted[0].id, [])
    expect(await c).toEqual([])
  })

  it('settled() waits for the edits asked for so far', async () => {
    const { client, procs } = setup()
    let done = false
    void client.edit('deleteMember', 'C:\\a.zip', 'x')
    void client.settled('C:\\a.zip').then(() => (done = true))
    await tick()
    expect(done).toBe(false)
    procs[0].answer(procs[0].posted[0].id, true)
    await tick()
    await tick()
    expect(done).toBe(true)
  })
})
