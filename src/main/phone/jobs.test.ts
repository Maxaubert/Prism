import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HlsJobs } from './jobs'
import { fakeFfmpeg, type FakeFfmpegOptions } from './testing/fakeFfmpeg'

let base: string
const plan = { mode: 'hls' as const, copyVideo: false, copyAudio: false, tonemap: false, height: null, audioOnly: false }

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
    const { id, playlist } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    expect(playlist).toContain('24.m4s')
    expect(spawned).toHaveLength(0) // opening is a playlist, not a process
    const p0 = await jobs.segment(id, 0)
    expect(p0 && existsSync(p0)).toBe(true)
    expect(spawned).toHaveLength(1)
    const p2 = await jobs.segment(id, 2)
    expect(p2?.endsWith('2.m4s')).toBe(true)
    expect(spawned).toHaveLength(1) // waited, no restart
    expect(await jobs.init(id)).toContain('init.mp4')
    expect(jobs.owner(id)).toBe('t')
    expect(jobs.owner('nope')).toBeNull()
    // The playlist for an open job is the one open returned; an unknown job has none.
    expect(jobs.playlist(id)).toBe(playlist)
    expect(jobs.playlist('nope')).toBeNull()
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

  it('reaps a job nobody asked about for 30 seconds, and its directory', async () => {
    let t = 0
    const { jobs, spawned } = make({}, () => t)
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    await jobs.segment(id, 0)
    expect(existsSync(join(base, id))).toBe(true)
    t = 20_000
    await jobs.reap()
    expect(existsSync(join(base, id))).toBe(true) // asked about recently enough
    t = 31_000
    await jobs.reap()
    expect(existsSync(join(base, id))).toBe(false)
    expect(spawned[0].killed).toBe(true)
    expect(await jobs.segment(id, 1)).toBeNull()
    expect(jobs.owner(id)).toBeNull()
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
