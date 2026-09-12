/**
 * One ffmpeg per phone and file (2026-09-06, #105). A job knows where it
 * started, what it has produced (the highest complete segment on disk from
 * that start, with `temp_file` making "on disk" mean complete), and when it
 * was last asked about. A segment ask is one of three things (`nextAction`,
 * pure): serve it, wait for it (a few segments ahead of the head, under a
 * second at 7-15x realtime), or kill the run and restart it at that
 * segment. A run that has EXITED short of what is asked for is restarted
 * as well, never reported as a failure: ffmpeg finishing is not ffmpeg
 * refusing. A job nobody asks about for 30s has its ffmpeg killed, one
 * idle for ten minutes loses its segments, and the RECORD stays for as long
 * as the phone does. The encoder flips to software after ONE GPU refusal and stays
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
import {
  hlsArgs,
  jobId,
  looksLikeGpuFailure,
  nextAction,
  playlistText,
  segmentCount,
  segmentFile,
  type Encoder
} from './hls'

/** A job nobody has asked about for this long has its ffmpeg KILLED, and
 *  nothing else: the record and the segments stay, so a phone that was
 *  paused (a player fetches nothing while paused) resumes with a restart at
 *  the segment it asks for, about a second, rather than a 404 for a job that
 *  no longer exists and a fatal error in its player. */
const IDLE_KILL_MS = 30_000
/** A job nobody has asked about for THIS long loses its SEGMENTS - the
 *  directory, which is what a job costs - and nothing else. The record used
 *  to go with it (2026-09-12), and a phone paused longer than ten minutes -
 *  the owner's iPad, asleep for the night - came back to a 404 on every
 *  segment and a player that had given up, where a refresh (a fresh
 *  `/api/play`) worked. A record is a few hundred bytes; it is the phone's
 *  stream for as long as the phone is paired, and the next ask restarts
 *  ffmpeg where it stands, exactly as after the 30s kill. */
const IDLE_DROP_MS = 10 * 60_000
/** How long a segment ask waits for its file before giving up. */
const WAIT_MS = 30_000
/** How far behind the newest ask a segment can be and still be wanted. A
 *  player fetching ahead is a segment or two apart; a seek is hundreds. */
const BEHIND_IS_GONE = 4
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
  /** The phone log (`diag.ts`): every ask, start, exit, kill and reap,
   *  one line each, so a hitch on the phone can be laid against what the
   *  PC was doing at that second. */
  log?: (line: string) => void
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
  /** The reaper removed this job's directory; the next start makes it again.
   *  Only so the ten-minute sweep does not rm an already-empty job every
   *  tick for as long as the phone stays paired. */
  emptied: boolean
  /** The segment of the LATEST ask, which is how an ask knows it has been
   *  left behind: two asks far apart each restarted ffmpeg at their own
   *  segment and killed the other's run, so neither was ever served. */
  lastWanted: number
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
  private readonly log: (line: string) => void

  constructor(private readonly deps: JobDeps) {
    this.spawn = deps.spawn ?? nodeSpawn
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => undefined)
  }

  /** Registers (or refreshes) the job for this phone and file; returns its
   *  id. No process starts here, and no playlist is written here either:
   *  `playlist` below is the ONE producer, because it is the one that
   *  carries the phone's token onto every segment uri, and a second copy
   *  without it is a playlist nothing can fetch. ffmpeg runs when a segment
   *  is asked for. */
  open(a: StartArgs): { id: string } {
    const id = jobId(a.token, a.file)
    const existing = this.jobs.get(id)
    if (existing) {
      existing.asked = this.now()
      // A fresh ask is a fresh chance: one ffmpeg that fell over used to be
      // a 404 for that film until the job was dropped ten minutes later,
      // however many times the phone reloaded the page.
      existing.failed = null
      return { id }
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
      emptied: false,
      lastWanted: 0,
      stderr: '',
      failed: null
    }
    this.jobs.set(id, job)
    return { id }
  }

  /** The phone a job belongs to, so a route can refuse another phone's
   *  token without confirming the job exists. */
  owner(id: string): string | null {
    return this.jobs.get(id)?.token ?? null
  }

  /** The file a job streams, so a route can re-check it against the
   *  phone's root as it is NOW: a job is walled when it is opened, and a
   *  tab can be closed, or the phone moved to another tab, while it runs. */
  file(id: string): string | null {
    return this.jobs.get(id)?.file ?? null
  }

  /** Stop and discard every job of one phone: it was forgotten, or it moved
   *  to another folder, and a stream it can no longer open must not carry on. */
  async stopFor(token: string): Promise<void> {
    const gone: Job[] = []
    for (const [id, job] of this.jobs) {
      if (job.token === token) {
        this.jobs.delete(id)
        gone.push(job)
      }
    }
    await Promise.all(gone.map((job) => this.discard(job)))
  }

  lastError(id: string): string | null {
    return this.jobs.get(id)?.failed ?? null
  }

  /** The job's playlist, for the `/hls/<job>/index.m3u8` route, written
   *  from the duration `open` recorded: it lives here and nowhere else, so
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
    job.emptied = false
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
      const proc = this.spawn(this.deps.ffmpeg, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      job.proc = proc
      proc.stderr?.on('data', (c: Buffer) => {
        job.stderr = (job.stderr + c.toString()).slice(-4000)
      })
      const said = (): string =>
        job.stderr
          .trim()
          .split(/\r?\n|\r/)
          .filter(Boolean)
          .pop() ?? ''
      this.log(
        `job ${job.id} start at segment ${at} (${this.encoder.video}, ${job.plan.copyVideo ? 'copy' : 'encode'} video, ${job.plan.copyAudio ? 'copy' : 'encode'} audio)`
      )
      if (DEBUG) {
        console.log(`[phone hls] ${job.id} start at segment ${at} (${this.encoder.video})`)
        proc.on('exit', (code) => console.log(`[phone hls] ${job.id} exit ${code}: ${said()}`))
      }
      proc.on('error', (err) => {
        if (job.proc !== proc) return
        job.proc = null
        job.failed = err.message
      })
      // CLOSE, not exit: `exit` fires when the process is gone, which can be
      // BEFORE its stderr has drained, and everything decided here is decided
      // from stderr - whether the GPU refused, and what to tell the phone. On
      // `exit` a fast NVENC refusal read as an empty reason and never fell
      // back to software.
      proc.on('close', (code) => {
        // A run this job already replaced (or killed) has nothing to say.
        if (job.proc !== proc) return
        job.proc = null
        this.log(`job ${job.id} exit ${code}${code === 0 ? '' : `: ${said()}`}`)
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
    if (p) {
      this.log(`job ${job.id} kill (run from segment ${job.startSegment})`)
      p.kill()
    }
  }

  /** The path of a COMPLETE segment file, starting or restarting ffmpeg as
   *  needed; null for a job or segment that does not exist, a failure, a
   *  film shorter than its probe said, or 30s of nothing. */
  async segment(id: string, n: number): Promise<string | null> {
    const job = this.jobs.get(id)
    if (!job || !Number.isInteger(n) || n < 0 || n >= job.total) return null
    const from = this.now()
    const answer = await this.segmentInner(job, id, n)
    const took = this.now() - from
    // Every ask, with what it cost: a served segment that WAITED is a run
    // behind the player, and a null is the 404 the phone is about to get.
    this.log(
      `ask ${job.id} #${n} ${answer ? 'served' : `404 (${job.failed ?? 'not produced'})`}${took > 0 ? ` after ${took}ms` : ''}`
    )
    return answer
  }

  private async segmentInner(job: Job, id: string, n: number): Promise<string | null> {
    job.asked = this.now()
    job.lastWanted = n
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
      // AN ASK THE PLAYER HAS LEFT BEHIND STOPS ASKING. Two asks far apart
      // (a prefetch and a seek arriving together) each restarted ffmpeg at
      // their own segment and killed the other's run, so neither was ever
      // served. The test is DISTANCE, not order: a player asking for two
      // adjacent segments at once wants both, and one run serves them, while
      // an ask left far behind the newest is a position nobody is watching
      // any more. It gives up at once, and the 404 its player retries beats
      // a connection held for thirty seconds.
      if (n + BEHIND_IS_GONE < job.lastWanted) {
        this.log(`ask ${job.id} #${n} left behind (newest ask #${job.lastWanted})`)
        return null
      }
      const want = nextAction({
        startSegment: job.startSegment,
        produced,
        wanted: n,
        total: job.total
      })
      if (!job.proc) {
        // Nothing running. A run that exited at exactly this segment and
        // made nothing of it is the film ending early: not worth 30s.
        if (job.ended && job.startSegment === n) return null
        void this.start(job, n)
        continue
      }
      if (want === 'restart') {
        this.log(
          `ask ${job.id} #${n} restarts the run (head at #${produced}, started at #${job.startSegment})`
        )
        void this.start(job, n)
        continue
      }
      await sleep(POLL_MS)
    }
    return null
  }

  /** init.mp4 for the job, once ffmpeg has written it. Every run writes one
   *  first thing, so a job with nothing running is started where it stands.
   *
   *  COMPLETE, not merely present (2026-09-12). The muxer CREATES the init
   *  file empty when the run opens its output and writes the moov into it
   *  only as the first segment is flushed - measured at 0 bytes 100ms into a
   *  copy run and 1457 bytes at 150ms, beside the first three segments. The
   *  player asks for init.mp4 FIRST, before any segment, so it is the ask
   *  that starts the run and it landed inside that window every time: hls.js
   *  got 0 bytes, "initSegment does not contain moov or trak boxes", six
   *  parse retries and a stop. The signal is the run's FIRST SEGMENT on
   *  disk: ffmpeg closes the init file before it finalises any segment, so
   *  a segment under its final name means the moov is written and flushed.
   *  A size check would do for the empty case and not for a partial one. */
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
      const { init, segments } = await this.onDisk(job)
      if (job.starting) continue
      if (job.failed) return null
      if (init && segments.has(job.startSegment)) return join(job.dir, INIT_FILE)
      if (!job.proc) {
        if (job.ended) return null
        void this.start(job, job.startSegment)
        continue
      }
      await sleep(POLL_MS)
    }
    return null
  }

  /** Kill the ffmpeg of jobs nobody asked about for 30s, and remove the
   *  segments of jobs nobody asked about for ten minutes; called on a timer
   *  by the server. The record outlives both: a job leaves only with its
   *  phone (`stopFor`) or the server (`stopAll`). */
  async reap(): Promise<void> {
    const now = this.now()
    const emptied: Job[] = []
    for (const job of this.jobs.values()) {
      if (job.asked < now - IDLE_DROP_MS && !job.emptied) {
        this.kill(job)
        // Whatever the run had produced is gone, so a run that ENDED must
        // not be believed on the next ask: `ended` at the asked segment is
        // read as "the film is shorter than its probe said", and that would
        // be a 404 for a film whose files were simply reaped.
        job.ended = false
        job.emptied = true
        this.log(`job ${job.id} idle ten minutes: segments removed, record kept`)
        emptied.push(job)
      } else if (job.asked < now - IDLE_KILL_MS && job.proc) {
        this.kill(job)
      }
    }
    await Promise.all(emptied.map((job) => fsp.rm(job.dir, { recursive: true, force: true })))
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
