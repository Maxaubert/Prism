import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { argsAgainst, pathsFromArgv, pathsFromArgvAsync } from './argv'

/**
 * What the command line asked for.
 *
 * Two bugs live here, and the second one was caused by fixing the first.
 *
 * It used to walk argv BACKWARDS and return at the first hit, so
 * `prism a.jpg b.jpg` showed b.jpg and dropped a.jpg without a word.
 *
 * Walking forwards then opened Electron's OWN ENTRY SCRIPT: unpackaged,
 * argv[1] is `out/main/index.js`, which exists, so Prism opened a second tab
 * called "main" beside the one you asked for. Six e2e scenarios caught it.
 */

const dir = mkdtempSync(join(tmpdir(), 'prism-argv-'))
const a = join(dir, 'a.jpg')
const b = join(dir, 'b.jpg')
const sub = join(dir, 'sub')
writeFileSync(a, 'x')
writeFileSync(b, 'x')
mkdirSync(sub)

describe('reading the command line', () => {
  it('takes every path, in the order they were named', () => {
    expect(pathsFromArgv(['prism.exe', a, b], [])).toEqual([
      { path: a, dir: false },
      { path: b, dir: false }
    ])
  })

  it('skips the app own entry script, wherever it sits', () => {
    // By IDENTITY, not by position: Chromium reorders its own switches, so a
    // second instance arrives with the script AFTER them. The positional
    // version passed at launch and failed on every handoff.
    const own = join(dir, 'index.js')
    writeFileSync(own, 'x')
    expect(pathsFromArgv(['electron.exe', own, a], [own])).toEqual([{ path: a, dir: false }])
    expect(pathsFromArgv(['electron.exe', '--user-data-dir=C:\\x', '--e2e', own, a], [own])).toEqual(
      [{ path: a, dir: false }]
    )
  })

  it('skips switches', () => {
    expect(pathsFromArgv(['prism.exe', '--e2e', '--user-data-dir=C:\\x', a], [])).toEqual([
      { path: a, dir: false }
    ])
  })

  it('says which are folders', () => {
    expect(pathsFromArgv(['prism.exe', sub], [])).toEqual([{ path: sub, dir: true }])
  })

  it('ignores what does not exist', () => {
    expect(pathsFromArgv(['prism.exe', join(dir, 'nope.jpg'), a], [])).toEqual([
      { path: a, dir: false }
    ])
  })

  it('opens a repeated path once', () => {
    expect(pathsFromArgv(['prism.exe', a, a], [])).toEqual([{ path: a, dir: false }])
  })

  it('answers nothing for a bare launch', () => {
    expect(pathsFromArgv(['prism.exe'], [])).toEqual([])
  })
})

describe('reading a handoff off the main thread (2026-10-12)', () => {
  it('gives the same answer as the startup reader', async () => {
    const own = join(dir, 'index.js')
    writeFileSync(own, 'x')
    const cases: Array<[string[], string[]]> = [
      [['prism.exe', a, b], []],
      [['electron.exe', '--user-data-dir=C:\\x', '--e2e', own, a], [own]],
      [['prism.exe', sub], []],
      [['prism.exe', join(dir, 'nope.jpg'), a], []],
      [['prism.exe', a, a], []],
      [['prism.exe'], []]
    ]
    for (const [argv, ignore] of cases) {
      expect(await pathsFromArgvAsync(argv, ignore)).toEqual(pathsFromArgv(argv, ignore))
    }
  })

  it('stops at the cap', async () => {
    const many = Array.from({ length: 40 }, (_, i) => {
      const p = join(dir, `m${i}.jpg`)
      writeFileSync(p, 'x')
      return p
    })
    expect(await pathsFromArgvAsync(['prism.exe', ...many], [])).toHaveLength(32)
    expect(pathsFromArgv(['prism.exe', ...many], [])).toHaveLength(32)
  })
})

// #21 (2026-11-01): a second instance's relative path is relative to ITS
// shell, which Electron hands over as `workingDirectory`. Read against the
// resident Prism's cwd, `prism photo.jpg` from D:\pics opened nothing, or an
// unrelated photo.jpg that happened to sit where Prism was first started.
describe('a path relative to the launching shell (#21)', () => {
  it('resolves against the cwd it is given, and answers it absolute', async () => {
    expect(await pathsFromArgvAsync(['prism.exe', 'a.jpg', 'sub'], [], dir)).toEqual([
      { path: a, dir: false },
      { path: sub, dir: true }
    ])
    expect(pathsFromArgv(['prism.exe', 'a.jpg'], [], dir)).toEqual([{ path: a, dir: false }])
  })

  it('never reads it against the resident process cwd', async () => {
    // The same name in the folder Prism itself runs in must not be what opens.
    const here = mkdtempSync(join(dir, 'shell-'))
    expect(await pathsFromArgvAsync(['prism.exe', 'a.jpg'], [], here)).toEqual([])
    expect(await pathsFromArgvAsync(['prism.exe', join('..', 'a.jpg')], [], here)).toEqual([
      { path: a, dir: false }
    ])
  })

  it('leaves an absolute path as it was', async () => {
    expect(await pathsFromArgvAsync(['prism.exe', a], [], join(dir, 'sub'))).toEqual([{ path: a, dir: false }])
  })

  it('makes a relaunch command line absolute, switches untouched', () => {
    expect(argsAgainst(['--e2e', 'a.jpg', a, '--user-data-dir=C:\\x'], dir)).toEqual([
      '--e2e',
      a,
      a,
      '--user-data-dir=C:\\x'
    ])
  })
})
