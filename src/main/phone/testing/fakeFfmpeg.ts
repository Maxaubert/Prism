/**
 * A stand-in for ffmpeg's HLS run, for the job tests and the server tests
 * (2026-09-06, #105). It is a `spawn` that reads the argv `hlsArgs` builds
 * (the output directory from the last argument, the first segment from
 * `-start_number`), writes `init.mp4` at once and then one segment file
 * every few milliseconds, and exits 0 after a handful, the way a short film
 * ends. `kill()` stops it mid-run and reports a null exit code, as a
 * signalled process does. Optionally the FIRST run fails with a given
 * stderr line, which is how the GPU fallback is exercised.
 *
 * Test-only: the sync writes here are a fake process's business, not main's.
 */
import type { spawn as nodeSpawn } from 'child_process'
import { EventEmitter } from 'events'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface FakeRun {
  args: string[]
  /** The segment the run was started at. */
  start: number
  killed: boolean
  kill: () => void
}

export interface FakeFfmpegOptions {
  /** Segment files a run writes before it exits 0 (default 7). */
  segments?: number
  /** Milliseconds between segment files (default 20). */
  intervalMs?: number
  /** The first run prints this to stderr and exits 1; later runs succeed. */
  failFirst?: string
}

export interface FakeFfmpeg {
  spawn: typeof nodeSpawn
  /** Every run, in the order it was spawned. */
  spawned: FakeRun[]
}

export function fakeFfmpeg(opts: FakeFfmpegOptions = {}): FakeFfmpeg {
  const segments = opts.segments ?? 7
  const intervalMs = opts.intervalMs ?? 20
  const spawned: FakeRun[] = []
  const spawn = (_cmd: string, args: string[]): ReturnType<typeof nodeSpawn> => {
    const outDir = args[args.length - 1].replace(/\/ffmpeg\.m3u8$/, '')
    const start = Number(args[args.indexOf('-start_number') + 1])
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter
      stdout: EventEmitter
      kill: () => boolean
      pid: number
    }
    child.stderr = new EventEmitter()
    child.stdout = new EventEmitter()
    child.pid = spawned.length + 1
    const run: FakeRun = { args, start, killed: false, kill: () => child.kill() }
    spawned.push(run)
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    child.kill = () => {
      if (!alive) return false
      alive = false
      run.killed = true
      if (timer) clearInterval(timer)
      // A real process exits on the next tick, never inside kill().
      setImmediate(() => child.emit('exit', null, 'SIGTERM'))
      return true
    }
    if (opts.failFirst && spawned.length === 1) {
      const line = opts.failFirst
      setImmediate(() => {
        if (!alive) return
        alive = false
        child.stderr.emit('data', Buffer.from(line + '\n'))
        child.emit('exit', 1, null)
      })
      return child as never
    }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'init.mp4'), 'init')
    let n = start
    const done = (code: number | null): void => {
      alive = false
      if (timer) clearInterval(timer)
      child.emit('exit', code, null)
    }
    timer = setInterval(() => {
      if (!alive) return
      if (n >= start + segments) return done(0)
      try {
        writeFileSync(join(outDir, `${n}.m4s`), `seg${n}`)
      } catch {
        // The directory went away under the run (a test tearing down
        // early): a real ffmpeg would die on the write, so this one does.
        return done(1)
      }
      n += 1
    }, intervalMs)
    return child as never
  }
  return { spawn: spawn as typeof nodeSpawn, spawned }
}
