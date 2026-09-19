import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractEvent } from '../shared/extraction'
import { ExtractJobs, Made, PROGRESS_EVERY_MS } from './extractJob'

/** A process, as far as the job cares: it can be killed, and it closes LATER,
 *  which is the whole point - `kill` returns before the handles are gone. */
class FakeChild extends EventEmitter {
  exitCode: number | null = null
  killed = 0
  kill(): void {
    this.killed += 1
  }
  close(): void {
    this.exitCode = 1
    this.emit('close')
  }
}

function harness(): { jobs: ExtractJobs; sent: ExtractEvent[]; clock: { t: number } } {
  const sent: ExtractEvent[] = []
  const clock = { t: 10_000 }
  const jobs = new ExtractJobs(
    (e) => sent.push(e),
    () => clock.t
  )
  return { jobs, sent, clock }
}

describe('an extraction job', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens the window when it begins, and names the archive and the place', () => {
    const { jobs, sent } = harness()
    const job = jobs.begin({ archive: 'a.zip', dest: 'C:\\out' })
    expect(job).not.toBeNull()
    expect(sent).toEqual([{ type: 'start', id: job!.id, archive: 'a.zip', dest: 'C:\\out' }])
  })

  it('runs ONE at a time: a second is refused while the first is up', () => {
    const { jobs, sent } = harness()
    const first = jobs.begin({ archive: 'a.zip', dest: 'C:\\out' })!
    expect(jobs.begin({ archive: 'b.zip', dest: 'C:\\out' })).toBeNull()
    expect(sent).toHaveLength(1)
    first.end('done')
    // Free in the same turn: the caller that was waiting on the first may
    // start the next without a tick in between.
    expect(jobs.begin({ archive: 'b.zip', dest: 'C:\\out' })).not.toBeNull()
  })

  it('sends the first progress at once and coalesces the flood behind it', () => {
    const { jobs, sent, clock } = harness()
    const job = jobs.begin({ archive: 'a.zip', dest: 'C:\\out' })!
    job.progress(1, 'one')
    for (let i = 2; i <= 50; i += 1) job.progress(i, `file ${i}`)
    const progress = (): ExtractEvent[] => sent.filter((e) => e.type === 'progress')
    expect(progress()).toEqual([{ type: 'progress', id: job.id, pct: 1, file: 'one' }])
    // The LAST value gets out, so the bar never sticks short of the work.
    clock.t += PROGRESS_EVERY_MS
    vi.advanceTimersByTime(PROGRESS_EVERY_MS)
    expect(progress()).toHaveLength(2)
    expect(progress()[1]).toEqual({ type: 'progress', id: job.id, pct: 50, file: 'file 50' })
  })

  it('keeps the last percentage under a message that carries only a name', () => {
    const { jobs, sent, clock } = harness()
    const job = jobs.begin({ archive: 'a.zip', dest: 'C:\\out' })!
    job.progress(40, 'a')
    clock.t += PROGRESS_EVERY_MS
    job.progress(null, 'b')
    expect(sent[sent.length - 1]).toEqual({ type: 'progress', id: job.id, pct: 40, file: 'b' })
  })

  it('says how it ended exactly once, and nothing after that', () => {
    const { jobs, sent } = harness()
    const job = jobs.begin({ archive: 'a.zip', dest: 'C:\\out' })!
    job.progress(10, 'a')
    job.progress(20, 'b') // queued behind the throttle
    job.end('failed', 'failed', 'ERROR: Data Error')
    job.end('done')
    job.progress(99, 'late')
    vi.advanceTimersByTime(1000)
    expect(sent.filter((e) => e.type === 'end')).toEqual([
      { type: 'end', id: job.id, result: 'failed', reason: 'failed', message: 'ERROR: Data Error' }
    ])
    expect(sent[sent.length - 1].type).toBe('end')
  })

  it('Cancel kills the child and WAITS for it to close', async () => {
    const { jobs } = harness()
    const job = jobs.begin({ archive: 'a.7z', dest: 'C:\\out' })!
    const child = new FakeChild()
    job.attach(child)
    let cancelled = false
    const asked = jobs.cancel(job.id).then((r) => {
      cancelled = true
      return r
    })
    await Promise.resolve()
    expect(job.cancelled).toBe(true)
    expect(child.killed).toBe(1)
    // Killed is not gone: nothing may be cleaned up yet.
    expect(cancelled).toBe(false)
    child.close()
    await Promise.resolve()
    expect(cancelled).toBe(false) // the route has not finished its clean-up
    job.end('cancelled')
    expect(await asked).toBe(true)
    expect(jobs.running()).toBeNull()
  })

  it('a Cancel that arrives before 7-Zip was spawned stops it at the spawn', () => {
    const { jobs } = harness()
    const job = jobs.begin({ archive: 'a.7z', dest: 'C:\\out' })!
    void job.cancel()
    const child = new FakeChild()
    job.attach(child)
    expect(child.killed).toBe(1)
  })

  it('does not wait for ever on a child that will not die', async () => {
    const { jobs } = harness()
    const job = jobs.begin({ archive: 'a.7z', dest: 'C:\\out' })!
    job.attach(new FakeChild())
    let done = false
    void job.cancel(500).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(499)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(done).toBe(true)
  })

  it('cancelling a job that is not the running one does nothing', async () => {
    const { jobs } = harness()
    const job = jobs.begin({ archive: 'a.7z', dest: 'C:\\out' })!
    expect(await jobs.cancel('extract-999')).toBe(false)
    expect(job.cancelled).toBe(false)
  })
})

describe('taking back what a cancelled extraction made', () => {
  let box = ''
  beforeEach(() => {
    box = mkdtempSync(join(tmpdir(), 'prism-made-'))
  })
  afterEach(() => rmSync(box, { recursive: true, force: true }))

  it('removes a staging folder whole', async () => {
    const made = new Made()
    const stage = join(box, '.prism-extract-abc')
    mkdirSync(join(stage, 'deep'), { recursive: true })
    writeFileSync(join(stage, 'deep', 'half.bin'), 'partial')
    made.tree(stage)
    await made.undo()
    expect(existsSync(stage)).toBe(false)
  })

  it('removes the files it wrote and the folders it created, and NOTHING that was there before', async () => {
    // The destination already holds the user's own folder and file.
    mkdirSync(join(box, 'Photos'))
    writeFileSync(join(box, 'Photos', 'mine.jpg'), 'keep me')
    writeFileSync(join(box, 'notes.txt'), 'keep me too')

    const made = new Made()
    // The extraction writes INTO the existing folder, and makes a new one.
    await made.mkdir(join(box, 'Photos'))
    writeFileSync(join(box, 'Photos', 'from-zip.jpg'), 'x')
    made.file(join(box, 'Photos', 'from-zip.jpg'))
    await made.mkdir(join(box, 'New', 'Inner'))
    writeFileSync(join(box, 'New', 'Inner', 'a.txt'), 'x')
    made.file(join(box, 'New', 'Inner', 'a.txt'))

    await made.undo()
    expect(existsSync(join(box, 'Photos', 'from-zip.jpg'))).toBe(false)
    expect(existsSync(join(box, 'New'))).toBe(false)
    expect(existsSync(join(box, 'Photos', 'mine.jpg'))).toBe(true)
    expect(existsSync(join(box, 'notes.txt'))).toBe(true)
  })

  it('leaves a folder it created alone once somebody else has put a file in it', async () => {
    const made = new Made()
    await made.mkdir(join(box, 'New'))
    writeFileSync(join(box, 'New', 'ours.txt'), 'x')
    made.file(join(box, 'New', 'ours.txt'))
    writeFileSync(join(box, 'New', 'theirs.txt'), 'arrived meanwhile')
    await made.undo()
    expect(existsSync(join(box, 'New', 'ours.txt'))).toBe(false)
    expect(existsSync(join(box, 'New', 'theirs.txt'))).toBe(true)
  })
})
