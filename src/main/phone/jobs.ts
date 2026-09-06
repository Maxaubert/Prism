/**
 * One ffmpeg per phone and file (2026-09-06, #105). A job knows where it
 * started, what it has produced (the highest complete segment on disk from
 * that start, with `temp_file` making "on disk" mean complete), and when it
 * was last asked about. A segment ask is one of three things (`nextAction`,
 * pure): serve it, wait for it (a few segments ahead of the head, under a
 * second at 7-15x realtime), or kill the run and restart it at that
 * segment. A run that has EXITED short of what is asked for is restarted
 * as well, never reported as a failure: ffmpeg finishing is not ffmpeg
 * refusing. A job nobody asks about for 30s is reaped, and its directory
 * with it. The encoder flips to software after ONE GPU refusal and stays
 * there for the session: a machine without NVENC would otherwise pay the
 * refusal on every seek.
 *
 * Nothing here is synchronous on main's thread: the process is `spawn`ed,
 * the directory is read, made and removed through `fs/promises`, and a
 * segment on its way is waited for with a 100ms poll. A restart is
 * serialised per job (`starting`) so two asks that both decide to seek
 * spawn one ffmpeg between them, and a generation number lets a start that
 * was superseded while it was clearing the directory stand down quietly.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'child_process'
import { promises as fsp } from 'fs'
import { join } from 'path'
import type { PlayPlan } from './decide'
import { hlsArgs, jobId, looksLikeGpuFailure, nextAction, playlistText, segmentCount, segmentFile, type Encoder } from './hls'

/** A job nobody has asked about for this long is over. */
const IDLE_MS = 30_000
/** How long a segment ask waits for its file before giving up. */
const WAIT_MS = 30_000
const POLL_MS = 100
const INIT_FILE = 'init.mp4'
/** `PRISM_PHONE_DEBUG=1`: ffmpeg's own progress line (`-stats`, so it is
 *  printed at `-loglevel error` too) and its last word on exit, per job, to
 *  the console. Nothing else, and nothing without the variable. */
const DEBUG = !!process.env.PRISM_PHONE_DEBUG

export interface JobDeps {
  ffmpeg: string
  /** userData/phone/hls: one directory per job under it. */
  baseDir: string
  /** Injectable for tests (`testing/fakeFfmpeg.ts`). */
  spawn?: typeof nodeSpawn
  now?: () => number
}

export interface StartArgs {
  token: string
  file: string
  plan: PlayPlan & { mode: 'hls' }
  duration: number
  audioIndex: number | null
}

interface Job extends StartArgs {
  id: string
  dir: string
  total: number
  proc: ChildProcess | null
  /** A start in progress (clearing the directory, then spawning). */
  starting: Promise<void> | null
  /** Bumped by every start; a start that finds itself superseded stops. */
  gen: number
  startSegment: number
  /** The run started at `startSegment` exited cleanly: whatever is on disk
   *  is everything it will ever make. */
  ended: boolean
  asked: number
  stderr: string
  failed: string | null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class HlsJobs {
  private readonly jobs = new Map<string, Job>()
  /** The encoder in use; flips to openh264 after one GPU failure and stays. */
  encoder: Encoder = { video: 'nvenc' }
  private readonly spawn: typeof nodeSpawn
  private readonly now: () => number

  constructor(private readonly deps: JobDeps) {
    this.spawn = deps.spawn ?? nodeSpawn
    this.now = deps.now ?? Date.now
  }

  /** Registers (or refreshes) the job for this phone and file; returns its
   *  id and the playlist. No process starts here: the playlist is written
   *  from the duration alone, and ffmpeg runs when a segment is asked for. */
  open(a: StartArgs): { id: string; playlist: string } {
    const id = jobId(a.token, a.file)
    const existing = this.jobs.get(id)
    if (existing) {
      existing.asked = this.now()
      return { id, playlist: playlistText(existing.duration) }
    }
    const job: Job = {
      ...a,
      id,
      dir: join(this.deps.baseDir, id),
      total: segmentCount(a.duration),
      proc: null,
      starting: null,
      gen: 0,
      startSegment: 0,
      ended: false,
      asked: this.now(),
      stderr: '',
      failed: null
    }
    this.jobs.set(id, job)
    return { id, playlist: playlistText(a.duration) }
  }

  /** The phone a job belongs to, so a route can refuse another phone's
   *  token without confirming the job exists. */
  owner(id: string): string | null {
    return this.jobs.get(id)?.token ?? null
  }

  lastError(id: string): string | null {
    return this.jobs.get(id)?.failed ?? null
  }

  /** The job's playlist, as `open` wrote it, for the `/hls/<job>/index.m3u8`
   *  route: the duration it is written from lives here and nowhere else, so
   *  the server never keeps a second table that the reaper would leave
   *  behind. Fetching it is an ask, and keeps the job alive. `query` is
   *  what the route wants on every segment uri (the phone's `?t=`). */
  playlist(id: string, query = ''): string | null {
    const job = this.jobs.get(id)
    if (!job) return null
    job.asked = this.now()
    return playlistText(job.duration, query)
  }

  /** What the job's directory holds: the segment numbers and whether the
   *  init file is there. One readdir per look, never a stat per segment. */
  private async onDisk(job: Job): Promise<{ segments: Set<number>; init: boolean }> {
    let names: string[]
    try {
      names = await fsp.readdir(job.dir)
    } catch {
      return { segments: new Set(), init: false }
    }
    const segments = new Set<number>()
    let init = false
    for (const name of names) {
      const m = /^(\d+)\.m4s$/.exec(name)
      if (m) segments.add(Number(m[1]))
      else if (name === INIT_FILE) init = true
    }
    return { segments, init }
  }

  /** The highest COMPLETE segment the current run has written, walking up
   *  from where it started; -1 (or start - 1) when none yet. */
  private produced(job: Job, segments: Set<number>): number {
    let n = job.startSegment - 1
    while (segments.has(n + 1)) n += 1
    return n
  }

  /** Kill whatever runs and start ffmpeg at `at`. Serialised per job. */
  private start(job: Job, at: number): Promise<void> {
    const gen = ++job.gen
    this.kill(job)
    job.startSegment = at
    job.ended = false
    job.failed = null
    job.stderr = ''
    const run = (async (): Promise<void> => {
      // Cleared rather than reused: what is on disk is what THIS run made,
      // so `produced` can walk up from the start and mean it.
      await fsp.rm(job.dir, { recursive: true, force: true })
      await fsp.mkdir(job.dir, { recursive: true })
      if (job.gen !== gen || !this.jobs.has(job.id)) return
      const args = hlsArgs({
        ffmpeg: this.deps.ffmpeg,
        file: job.file,
        plan: job.plan,
        startSegment: at,
        outDir: job.dir,
        encoder: this.encoder,
        audioIndex: job.audioIndex
      })
      if (DEBUG) args.splice(args.indexOf('-nostdin'), 0, '-stats')
      const proc = this.spawn(this.deps.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      job.proc = proc
      proc.stderr?.on('data', (c: Buffer) => {
        job.stderr = (job.stderr + c.toString()).slice(-4000)
      })
      if (DEBUG) {
        const said = (): string => job.stderr.trim().split(/\r?\n|\r/).filter(Boolean).pop() ?? ''
        console.log(`[phone hls] ${job.id} start at segment ${at} (${this.encoder.video})`)
        proc.on('exit', (code) => console.log(`[phone hls] ${job.id} exit ${code}: ${said()}`))
      }
      proc.on('error', (err) => {
        if (job.proc !== proc) return
        job.proc = null
        job.failed = err.message
      })
      proc.on('exit', (code) => {
        // A run this job already replaced (or killed) has nothing to say.
        if (job.proc !== proc) return
        job.proc = null
        if (code === 0 || code === null) {
          job.ended = true
          return
        }
        if (this.encoder.video === 'nvenc' && looksLikeGpuFailure(job.stderr)) {
          // Once, for the session: the software path from here on.
          this.encoder = { video: 'openh264' }
          void this.start(job, at)
          return
        }
        const lines = job.stderr.trim().split('\n').filter(Boolean)
        job.failed = lines.pop() ?? `ffmpeg exited ${code}`
      })
    })()
    const starting: Promise<void> = run.finally(() => {
      if (job.starting === starting) job.starting = null
    })
    job.starting = starting
    return starting
  }

  private kill(job: Job): void {
    const p = job.proc
    job.proc = null
    if (p) p.kill()
  }

  /** The path of a COMPLETE segment file, starting or restarting ffmpeg as
   *  needed; null for a job or segment that does not exist, a failure, a
   *  film shorter than its probe said, or 30s of nothing. */
  async segment(id: string, n: number): Promise<string | null> {
    const job = this.jobs.get(id)
    if (!job || !Number.isInteger(n) || n < 0 || n >= job.total) return null
    job.asked = this.now()
    const deadline = this.now() + WAIT_MS
    while (this.now() < deadline && this.jobs.get(id) === job) {
      if (job.starting) {
        await job.starting
        continue
      }
      const { segments } = await this.onDisk(job)
      // The run can have exited, failed or been replaced during that read.
      if (job.starting) continue
      if (job.failed) return null
      if (segments.has(n)) return segmentFile(job.dir, n)
      const produced = this.produced(job, segments)
      if (!job.proc) {
        // Nothing running. A run that exited at exactly this segment and
        // made nothing of it is the film ending early: not worth 30s.
        if (job.ended && job.startSegment === n) return null
        void this.start(job, n)
        continue
      }
      if (nextAction({ startSegment: job.startSegment, produced, wanted: n, total: job.total }) === 'restart') {
        void this.start(job, n)
        continue
      }
      await sleep(POLL_MS)
    }
    return null
  }

  /** init.mp4 for the job, once ffmpeg has written it. Every run writes one
   *  first thing, so a job with nothing running is started where it stands. */
  async init(id: string): Promise<string | null> {
    const job = this.jobs.get(id)
    if (!job) return null
    job.asked = this.now()
    const deadline = this.now() + WAIT_MS
    while (this.now() < deadline && this.jobs.get(id) === job) {
      if (job.starting) {
        await job.starting
        continue
      }
      const { init } = await this.onDisk(job)
      if (job.starting) continue
      if (job.failed) return null
      if (init) return join(job.dir, INIT_FILE)
      if (!job.proc) {
        if (job.ended) return null
        void this.start(job, job.startSegment)
        continue
      }
      await sleep(POLL_MS)
    }
    return null
  }

  /** Kill jobs nobody asked about for 30s; called on a timer by the server. */
  async reap(): Promise<void> {
    const cutoff = this.now() - IDLE_MS
    const gone: Job[] = []
    for (const [id, job] of this.jobs) {
      if (job.asked < cutoff) {
        this.jobs.delete(id)
        gone.push(job)
      }
    }
    await Promise.all(gone.map((job) => this.discard(job)))
  }

  async stopAll(): Promise<void> {
    const all = [...this.jobs.values()]
    this.jobs.clear()
    await Promise.all(all.map((job) => this.discard(job)))
  }

  private async discard(job: Job): Promise<void> {
    job.gen += 1
    this.kill(job)
    if (job.starting) await job.starting.catch(() => undefined)
    await fsp.rm(job.dir, { recursive: true, force: true })
  }
}
