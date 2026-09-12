import { existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HlsJobs } from './jobs'
import { fakeFfmpeg, type FakeFfmpegOptions } from './testing/fakeFfmpeg'

let base: string
const plan = { mode: 'hls' as const, copyVideo: false, copyAudio: false, tonemap: false, height: null, audioOnly: false, hevcCopy: false }

function make(opts: FakeFfmpegOptions = {}, now?: () => number): { jobs: HlsJobs; spawned: ReturnType<typeof fakeFfmpeg>['spawned'] } {
  const fake = fakeFfmpeg(opts)
  return { jobs: new HlsJobs({ ffmpeg: 'f', baseDir: base, spawn: fake.spawn, now }), spawned: fake.spawned }
}

const startOf = (args: string[]): string => args[args.indexOf('-start_number') + 1]
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'prism-hls-'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('HlsJobs', () => {
  it('starts ffmpeg on the first segment ask and serves as files complete', async () => {
    const { jobs, spawned } = make()
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    expect(spawned).toHaveLength(0) // opening registers the job, no process
    // The playlist is written from the duration open recorded, by the one
    // producer; the route's query lands on every segment uri.
    expect(jobs.playlist(id)).toContain('24.m4s')
    expect(jobs.playlist(id, '?t=t')).toContain('24.m4s?t=t')
    const p0 = await jobs.segment(id, 0)
    expect(p0 && existsSync(p0)).toBe(true)
    expect(spawned).toHaveLength(1)
    const p2 = await jobs.segment(id, 2)
    expect(p2?.endsWith('2.m4s')).toBe(true)
    expect(spawned).toHaveLength(1) // waited, no restart
    expect(await jobs.init(id)).toContain('init.mp4')
    expect(jobs.owner(id)).toBe('t')
    expect(jobs.owner('nope')).toBeNull()
    // An unknown job has no playlist.
    expect(jobs.playlist('nope')).toBeNull()
    await jobs.stopAll()
  })

  it('serves init.mp4 only once it is complete, which is when the first segment has landed', async () => {
    const { jobs } = make({ intervalMs: 40 })
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    // The player asks for init.mp4 FIRST, before any segment, which is what
    // starts the run: the file exists empty for a moment before ffmpeg
    // writes the moov, and an empty init segment is a stream that never
    // starts (measured through hls.js: six parse failures, then a stop).
    const p = await jobs.init(id)
    expect(p).toContain('init.mp4')
    expect(statSync(p as string).size).toBeGreaterThan(0)
    await jobs.stopAll()
  })

  it('opening the same file from the same phone lands on the same job', () => {
    const { jobs } = make()
    const a = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    const b = jobs.open({ token: 't', file: 'c:\\A.MKV', plan, duration: 100, audioIndex: 1 })
    const c = jobs.open({ token: 'u', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    expect(b.id).toBe(a.id)
    expect(c.id).not.toBe(a.id)
  })

  it('restarts at a far seek and serves from there', async () => {
    const { jobs, spawned } = make()
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 400, audioIndex: 1 })
    await jobs.segment(id, 0)
    const p = await jobs.segment(id, 50)
    expect(p?.endsWith('50.m4s')).toBe(true)
    expect(spawned).toHaveLength(2)
    expect(spawned[0].killed).toBe(true)
    expect(startOf(spawned[1].args)).toBe('50')
    // init.mp4 belongs to the new run, and is there for the asking.
    expect(await jobs.init(id)).toContain('init.mp4')
    await jobs.stopAll()
  })

  it('a seek behind the running job restarts there too', async () => {
    const { jobs, spawned } = make()
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 400, audioIndex: 1 })
    await jobs.segment(id, 50)
    expect(startOf(spawned[0].args)).toBe('50')
    const p = await jobs.segment(id, 10)
    expect(p?.endsWith('10.m4s')).toBe(true)
    expect(spawned).toHaveLength(2)
    expect(startOf(spawned[1].args)).toBe('10')
    await jobs.stopAll()
  })

  it('a finished job that stopped short of the ask is restarted, not failed', async () => {
    // The fake writes 7 segments and exits 0; the playlist says 25.
    const { jobs, spawned } = make()
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    await jobs.segment(id, 0)
    await settle(250) // the first run has exited by now
    const p = await jobs.segment(id, 8)
    expect(p?.endsWith('8.m4s')).toBe(true)
    expect(spawned).toHaveLength(2)
    expect(startOf(spawned[1].args)).toBe('8')
    await jobs.stopAll()
  })

  it('a segment the film turns out not to have is null, not a 30s wait', async () => {
    // Started AT the wanted segment, the run exits 0 having written nothing
    // past it: the probe's duration was longer than the film.
    const { jobs, spawned } = make({ segments: 0 })
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    expect(await jobs.segment(id, 20)).toBeNull()
    expect(spawned).toHaveLength(1)
    expect(jobs.lastError(id)).toBeNull()
    await jobs.stopAll()
  })

  it('refuses a segment outside the playlist and an unknown job', async () => {
    const { jobs, spawned } = make()
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 10, audioIndex: 1 })
    expect(await jobs.segment(id, 99)).toBeNull()
    expect(await jobs.segment(id, -1)).toBeNull()
    expect(await jobs.segment(id, 1.5)).toBeNull()
    expect(await jobs.segment('nope', 0)).toBeNull()
    expect(await jobs.init('nope')).toBeNull()
    expect(spawned).toHaveLength(0)
    await jobs.stopAll()
  })

  it('drops to software after one GPU refusal and stays there', async () => {
    const { jobs, spawned } = make({ failFirst: '[h264_nvenc @ 0] Cannot load nvcuda.dll' })
    expect(jobs.encoder.video).toBe('nvenc')
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    const p = await jobs.segment(id, 0)
    expect(p?.endsWith('0.m4s')).toBe(true)
    expect(spawned).toHaveLength(2)
    expect(spawned[0].args).toContain('h264_nvenc')
    expect(spawned[1].args).toContain('libopenh264')
    expect(jobs.encoder.video).toBe('openh264')
    expect(jobs.lastError(id)).toBeNull()
    await jobs.stopAll()
  })

  it('reports a failure that is not the GPU, and does not retry it', async () => {
    const { jobs, spawned } = make({ failFirst: 'C:\\a.mkv: Invalid data found when processing input' })
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    expect(await jobs.segment(id, 0)).toBeNull()
    expect(spawned).toHaveLength(1)
    expect(jobs.lastError(id)).toContain('Invalid data')
    expect(jobs.encoder.video).toBe('nvenc')
    await jobs.stopAll()
  })

  it('a fresh ask after a failure tries again: one bad run is not a ten-minute 404', async () => {
    const { jobs, spawned } = make({ failFirst: 'C:\\a.mkv: Invalid data found when processing input' })
    const a = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    expect(await jobs.segment(a.id, 0)).toBeNull()
    expect(jobs.lastError(a.id)).toContain('Invalid data')
    // The phone reloads and asks again: /api/play opens the same job, which
    // is the moment the last failure stops counting.
    const b = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    expect(b.id).toBe(a.id)
    expect(jobs.lastError(b.id)).toBeNull()
    const p = await jobs.segment(b.id, 0)
    expect(p?.endsWith('0.m4s')).toBe(true)
    expect(spawned).toHaveLength(2)
    await jobs.stopAll()
  })

  it('two asks far apart do not restart each other: the newest wins', async () => {
    const { jobs, spawned } = make({ segments: 100, intervalMs: 10 })
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 4000, audioIndex: 1 })
    // A prefetch of segment 5 and a seek to 500 in the same breath. Each ask
    // used to restart ffmpeg at its own segment and kill the other's run, so
    // neither was ever served and both waited out the full deadline.
    const early = jobs.segment(id, 5)
    const late = jobs.segment(id, 500)
    const [e, l] = await Promise.all([early, late])
    expect(l?.endsWith('500.m4s')).toBe(true)
    // The older ask gave up at once rather than fighting: the player has
    // moved, and a 404 it retries beats a held connection.
    expect(e).toBeNull()
    expect(spawned.length).toBeLessThanOrEqual(2)
    expect(startOf(spawned[spawned.length - 1].args)).toBe('500')
    await jobs.stopAll()
  })

  it('kills the ffmpeg of a job idle for 30 seconds but keeps the job, so a paused phone resumes', async () => {
    let t = 0
    const { jobs, spawned } = make({ segments: 100 }, () => t)
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 400, audioIndex: 1 })
    await jobs.segment(id, 0)
    expect(existsSync(join(base, id))).toBe(true)
    t = 20_000
    await jobs.reap()
    expect(spawned[0].killed).toBe(false) // asked about recently enough
    t = 31_000
    await jobs.reap()
    expect(spawned[0].killed).toBe(true)
    expect(existsSync(join(base, id))).toBe(true)
    expect(jobs.owner(id)).toBe('t')
    // The phone unpauses: the next segment ask restarts ffmpeg where it stands.
    const p = await jobs.segment(id, 40)
    expect(p?.endsWith('40.m4s')).toBe(true)
    expect(spawned).toHaveLength(2)
  })

  it('removes the segments of a job idle for ten minutes but KEEPS the job, so a long pause resumes', async () => {
    let t = 0
    const { jobs, spawned } = make({}, () => t)
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    await jobs.segment(id, 0)
    t = 10 * 60_000 + 1
    await jobs.reap()
    expect(existsSync(join(base, id))).toBe(false)
    expect(spawned[0].killed).toBe(true)
    // The phone slept through the night (owner, 2026-09-12: "woke up, tried
    // to watch more but couldn't unpause"). The job used to be gone, so every
    // ask was a 404 and the player gave up; it is the phone's stream for as
    // long as the phone is paired, and the ask restarts ffmpeg where it is.
    expect(jobs.owner(id)).toBe('t')
    const p = await jobs.segment(id, 1)
    expect(p?.endsWith('1.m4s')).toBe(true)
    expect(spawned).toHaveLength(2)
    expect(startOf(spawned[1].args)).toBe('1')
    // ...and the same for a job whose run had ENDED before the pause: the
    // film was fully produced, the files went, and it is asked for again.
    await settle(300)
    t += 11 * 60_000
    await jobs.reap()
    expect(existsSync(join(base, id))).toBe(false)
    expect((await jobs.segment(id, 0))?.endsWith('0.m4s')).toBe(true)
    expect(spawned).toHaveLength(3)
    await jobs.stopAll()
  })

  it('writes the timeline to the phone log: start, asks, restarts, kills', async () => {
    const lines: string[] = []
    let t = 0
    const fake = fakeFfmpeg({ segments: 3 })
    const jobs = new HlsJobs({ ffmpeg: 'f', baseDir: base, spawn: fake.spawn, now: () => t, log: (l) => lines.push(l) })
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    await jobs.segment(id, 0)
    await jobs.segment(id, 20)
    await settle(150)
    t = 31_000
    await jobs.reap()
    expect(lines).toContain(`job ${id} start at segment 0 (nvenc, encode video, encode audio)`)
    expect(lines.some((l) => l.startsWith(`ask ${id} #0 served`))).toBe(true)
    expect(lines.some((l) => l.startsWith(`ask ${id} #20 restarts the run`))).toBe(true)
    expect(lines.some((l) => l.startsWith(`job ${id} kill`))).toBe(true)
    await jobs.stopAll()
  })

  it('stopAll kills every run and removes every directory', async () => {
    const { jobs, spawned } = make()
    const a = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    const b = jobs.open({ token: 't', file: 'C:\\b.mkv', plan, duration: 100, audioIndex: 1 })
    await Promise.all([jobs.segment(a.id, 0), jobs.segment(b.id, 0)])
    await jobs.stopAll()
    expect(spawned.every((r) => r.killed)).toBe(true)
    expect(existsSync(join(base, a.id))).toBe(false)
    expect(existsSync(join(base, b.id))).toBe(false)
    expect(await jobs.segment(a.id, 0)).toBeNull()
  })
})
