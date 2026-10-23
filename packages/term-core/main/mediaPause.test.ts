import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMediaPause, MEDIA_HELPER_SCRIPT, mediaHelperCommand } from './mediaPause'
import type { MediaPause } from '../shared/dictationTypes'

/**
 * The media pause, checked against a FAKE helper (a Node script speaking the
 * same line protocol), never the real PowerShell: a unit test that paused the
 * owner's music would be a test nobody runs twice. Every child the module
 * starts is recorded through the injected spawn, which is how the last check of
 * each test (nothing left running) is made.
 */

const FIXTURE = join(__dirname, '__fixtures__', 'fakeMediaHelper.mjs')

let dir = ''
let log = ''
let children: ChildProcess[] = []
let made: MediaPause[] = []

const spawnAndRecord = ((file: string, args: string[], options: object) => {
  const child = spawn(file, args, options)
  children.push(child)
  return child
}) as typeof spawn

/** A media pause wired to the fake. `flags` are the fixture's own arguments. */
function media(flags: string[], timeoutMs = 3000): MediaPause {
  const m = createMediaPause({
    spawnImpl: spawnAndRecord,
    command: { file: process.execPath, args: [FIXTURE, '--log', log, ...flags] },
    timeoutMs
  })
  made.push(m)
  return m
}

const sent = (): string[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])

function gone(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((done) => child.once('exit', () => done()))
}

async function until(test: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error('waited too long')
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism media pause '))
  log = join(dir, 'requests.log')
  children = []
  made = []
})

afterEach(async () => {
  for (const m of made) m.dispose()
  await Promise.all(children.map(gone))
  rmSync(dir, { recursive: true, force: true })
})

describe('the media pause', () => {
  it('starts nothing until the first pause, then keeps ONE helper for every call', async () => {
    const m = media(['--sessions', 'spotify=Playing'])
    expect(children).toHaveLength(0)
    expect(await m.pausePlaying()).toBe('spotify')
    await m.resume('spotify')
    expect(await m.pausePlaying()).toBe('spotify')
    expect(children).toHaveLength(1)
    expect(sent()).toEqual(['pause 1', 'resume 2 spotify', 'pause 3'])
  })

  it('brings back only what WAS playing, and nothing the second time', async () => {
    const m = media(['--sessions', 'spotify=Playing,chrome=Paused,vlc=Playing,edge=Stopped'])
    expect(await m.pausePlaying()).toBe('spotify,vlc')
    // They are paused now, so there is nothing left for a second pause to claim:
    // a token only ever names what THIS pause stopped.
    expect(await m.pausePlaying()).toBe('')
  })

  it('resumes exactly the ids of the token, spaces in an id included', async () => {
    const m = media(['--sessions', 'Spotify AB.Music!App=Playing,chrome=Playing'])
    const token = await m.pausePlaying()
    expect(token).toBe('Spotify AB.Music!App,chrome')
    await m.resume(token)
    expect(sent()[1]).toBe('resume 2 Spotify AB.Music!App,chrome')
  })

  it('does nothing and starts nothing for an empty token', async () => {
    const m = media(['--sessions', 'spotify=Playing'])
    await m.resume('')
    expect(children).toHaveLength(0)
    expect(sent()).toEqual([])
  })

  it('cannot be made to say a second thing by a token with a newline in it', async () => {
    const m = media(['--sessions', 'spotify=Playing'])
    await m.resume('spotify\npause 9')
    expect(sent()).toEqual(['resume 1 spotifypause 9'])
  })

  it('gives an empty token when the helper does not answer in time, and resume still resolves', async () => {
    const m = media(['--mode', 'silent'], 150)
    const began = Date.now()
    expect(await m.pausePlaying()).toBe('')
    expect(Date.now() - began).toBeLessThan(2000)
    await expect(m.resume('spotify')).resolves.toBeUndefined()
  })

  it('undoes a pause whose answer arrives after its caller was told nothing was paused', async () => {
    // The dangerous half of a timeout: the helper was only slow, the music DID
    // stop, and the token that would have started it again was never handed out.
    const m = media(['--sessions', 'spotify=Playing', '--delay', '400'], 150)
    expect(await m.pausePlaying()).toBe('')
    await until(() => sent().some((line) => /^resume \d+ spotify$/.test(line)))
  })

  it('stands a helper down after two timeouts in a row, and starts a fresh one', async () => {
    const m = media(['--mode', 'silent'], 100)
    await m.pausePlaying()
    await m.pausePlaying()
    await gone(children[0])
    await m.pausePlaying()
    expect(children).toHaveLength(2)
  })

  it('ignores lines that are not answers, and answers to questions nobody asked', async () => {
    const m = media(['--sessions', 'spotify=Playing', '--mode', 'garbage'])
    expect(await m.pausePlaying()).toBe('spotify')
    await expect(m.resume('spotify')).resolves.toBeUndefined()
  })

  it('matches an answer to its call by number, not by the order they come back in', async () => {
    const m = media(['--sessions', 'spotify=Playing', '--mode', 'reverse'])
    const [first, second] = await Promise.all([m.pausePlaying(), m.pausePlaying()])
    expect(first).toBe('spotify')
    expect(second).toBe('')
  })

  it('answers empty when the helper dies mid-call, and starts another on the next pause', async () => {
    const m = media(['--sessions', 'spotify=Playing', '--mode', 'crash-once', '--marker', join(dir, 'crashed')])
    const began = Date.now()
    expect(await m.pausePlaying()).toBe('')
    // The crash is what ended the call, not the three-second clock.
    expect(Date.now() - began).toBeLessThan(2500)
    expect(await m.pausePlaying()).toBe('spotify')
    expect(children).toHaveLength(2)
  })

  it('never throws when the helper cannot be started at all', async () => {
    const m = createMediaPause({
      command: { file: join(dir, 'no such helper.exe'), args: [] },
      timeoutMs: 500
    })
    made.push(m)
    expect(await m.pausePlaying()).toBe('')
    await expect(m.resume('spotify')).resolves.toBeUndefined()
  })

  it('never throws when spawn itself throws', async () => {
    const m = createMediaPause({
      spawnImpl: (() => {
        throw new Error('no')
      }) as unknown as typeof spawn,
      timeoutMs: 200
    })
    expect(await m.pausePlaying()).toBe('')
    await expect(m.resume('spotify')).resolves.toBeUndefined()
    m.dispose()
  })

  it('kills the helper on dispose, answers whoever was waiting, and leaves no process behind', async () => {
    const m = media(['--mode', 'silent'], 3000)
    const waiting = m.pausePlaying()
    await until(() => sent().length === 1)
    m.dispose()
    expect(await waiting).toBe('')
    await gone(children[0])
    expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true)
    expect(() => process.kill(children[0].pid as number, 0)).toThrow()
    // Disposing twice, or with nothing running, is nothing.
    m.dispose()
  })

  it('can be used again after dispose: the next pause starts a fresh helper', async () => {
    const m = media(['--sessions', 'spotify=Playing'])
    expect(await m.pausePlaying()).toBe('spotify')
    m.dispose()
    await gone(children[0])
    expect(await m.pausePlaying()).toBe('spotify')
    expect(children).toHaveLength(2)
  })
})

describe('the real helper command', () => {
  it('is Windows PowerShell with an argv array and no profile', () => {
    const { file, args } = mediaHelperCommand()
    // By its full path under System32, never a bare name (code review 2026-09-24, #3).
    expect(file).toMatch(/System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i)
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'])
    expect(args[5]).toBe(MEDIA_HELPER_SCRIPT)
  })

  it('carries a script that survives being ONE argument', () => {
    // Node quotes an argument for CreateProcess by escaping double quotes, and
    // PowerShell's -Command then reads the result a second time: a script with
    // no double quote and no newline in it is one that neither can mangle.
    expect(MEDIA_HELPER_SCRIPT).not.toMatch(/["\r\n]/)
    expect(MEDIA_HELPER_SCRIPT.endsWith('\\')).toBe(false)
  })

  it('never reaches for the play/pause media key, which would START music that was off', () => {
    expect(MEDIA_HELPER_SCRIPT).not.toMatch(/keybd_event|SendKeys|TogglePlayPause|MEDIA_PLAY_PAUSE/i)
    expect(MEDIA_HELPER_SCRIPT).toContain('TryPauseAsync')
    expect(MEDIA_HELPER_SCRIPT).toContain('TryPlayAsync')
  })
})
