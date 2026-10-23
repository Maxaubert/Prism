import { EventEmitter } from 'events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { createStatGate, isRunnable, openFolderDefault, openTermPath, pathKinds, resolveTermPath } from './termPathOpen'

const tree = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'pt-paths-'))
  mkdirSync(join(root, 'docs', 'sign-off'), { recursive: true })
  writeFileSync(join(root, 'docs', 'sign-off', 'rapport.pdf'), 'pdf')
  writeFileSync(join(root, 'run.bat'), '@echo off')
  return root
}

describe('resolveTermPath', () => {
  it('resolves against the shell folder, either separator', () => {
    expect(resolveTermPath('C:\\work', 'docs/a.pdf')).toBe('C:\\work\\docs\\a.pdf')
    expect(resolveTermPath('C:\\work', '..\\up.txt')).toBe('C:\\up.txt')
    expect(resolveTermPath('C:\\work', 'D:/x/y.md')).toBe('D:\\x\\y.md')
    expect(resolveTermPath('C:\\work', '\\rooted.txt')).toBe('C:\\rooted.txt')
    expect(resolveTermPath('C:\\work', '~/n.txt', 'C:\\Users\\me')).toBe('C:\\Users\\me\\n.txt')
  })
  it('refuses a network share, a NUL, and a relative path with no folder', () => {
    expect(resolveTermPath('C:\\work', '\\\\server\\share\\a.txt')).toBeNull()
    expect(resolveTermPath('C:\\work', '//server/share/a.txt')).toBeNull()
    expect(resolveTermPath('C:\\work', 'a\0.txt')).toBeNull()
    expect(resolveTermPath('', 'docs/a.pdf')).toBeNull()
    expect(resolveTermPath('relative', 'docs/a.pdf')).toBeNull()
  })
})

describe('pathKinds', () => {
  it('says what exists, a file or a folder, and null for the rest', async () => {
    const root = tree()
    const got = await pathKinds(root, ['docs/sign-off/rapport.pdf', 'docs/sign-off/', 'missing/x.txt', 'and/or'])
    expect(got.map((g) => g?.kind ?? null)).toEqual(['file', 'dir', null, null])
    expect(got[0]?.abs).toBe(join(root, 'docs', 'sign-off', 'rapport.pdf'))
  })
})

describe('openTermPath', () => {
  const openers = () => ({ openPath: vi.fn(), revealPath: vi.fn() })
  it('opens a file and a folder', async () => {
    const root = tree()
    const o = openers()
    expect(await openTermPath(root, 'docs/sign-off/rapport.pdf', 'open', o)).toBe('opened')
    expect(await openTermPath(root, 'docs', 'open', o)).toBe('opened')
    expect(o.openPath).toHaveBeenCalledTimes(2)
    expect(o.revealPath).not.toHaveBeenCalled()
  })
  it('NEVER runs anything: a runnable file is shown in Explorer instead', async () => {
    const root = tree()
    const o = openers()
    expect(await openTermPath(root, 'run.bat', 'open', o)).toBe('revealed')
    expect(o.openPath).not.toHaveBeenCalled()
    expect(o.revealPath).toHaveBeenCalledWith(join(root, 'run.bat'))
  })
  it('reveals when asked, and does nothing for what does not exist', async () => {
    const root = tree()
    const o = openers()
    expect(await openTermPath(root, 'docs/sign-off/rapport.pdf', 'reveal', o)).toBe('revealed')
    expect(await openTermPath(root, 'missing.txt', 'open', o)).toBeNull()
    expect(o.openPath).not.toHaveBeenCalled()
  })
})

describe('isRunnable', () => {
  it('knows programs, scripts, shortcuts and installers, and not documents', () => {
    for (const f of ['a.exe', 'b.BAT', 'c.ps1', 'd.lnk', 'e.msi', 'f.js', 'g.vbs', 'h.py', 'i.url', 'j.reg'])
      expect(isRunnable(f)).toBe(true)
    for (const f of ['a.pdf', 'b.md', 'c.png', 'd.txt', 'e.docx', 'f.ts', 'g.json', 'README']) expect(isRunnable(f)).toBe(false)
  })
})

describe('a folder goes to the folder handler Windows has (Prism #393)', () => {
  it('a folder uses openFolder when the host has one; a file never does', async () => {
    const root = tree()
    const o = { openPath: vi.fn(), revealPath: vi.fn(), openFolder: vi.fn() }
    expect(await openTermPath(root, 'docs', 'open', o)).toBe('opened')
    expect(o.openFolder).toHaveBeenCalledWith(join(root, 'docs'))
    expect(await openTermPath(root, 'docs/sign-off/rapport.pdf', 'open', o)).toBe('opened')
    expect(o.openPath).toHaveBeenCalledWith(join(root, 'docs', 'sign-off', 'rapport.pdf'))
    expect(await openTermPath(root, 'run.bat', 'open', o)).toBe('revealed')
    expect(await openTermPath(root, 'docs', 'reveal', o)).toBe('revealed')
    expect(o.openFolder).toHaveBeenCalledTimes(1)
  })

  const fake = (behave: (child: EventEmitter) => void) => {
    const calls: Array<{ file: string; args: string[]; env: Record<string, string> }> = []
    const run = ((file: string, args: string[], options: { env: Record<string, string> }) => {
      calls.push({ file, args, env: options.env })
      const child = new EventEmitter()
      queueMicrotask(() => behave(child))
      return child
    }) as unknown as Parameters<typeof openFolderDefault>[2]
    return { calls, run }
  }

  it('asks Windows for its default verb with the path in the environment, never the command line', async () => {
    const odd = 'C:\\a & b\\100% [x] $(y)'
    const { calls, run } = fake((child) => child.emit('exit', 0))
    const fallback = vi.fn()
    openFolderDefault(odd, fallback, run)
    await new Promise((done) => setTimeout(done, 0))
    expect(calls[0].file).toBe('powershell.exe')
    expect(calls[0].args.join(' ')).not.toContain(odd)
    expect(calls[0].env.PT_OPEN_FOLDER).toBe(odd)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('anything short of a clean exit falls back, once', async () => {
    for (const behave of [
      (child: EventEmitter) => child.emit('exit', 1),
      (child: EventEmitter) => {
        child.emit('error', new Error('no powershell'))
        child.emit('exit', -4058)
      }
    ]) {
      const { run } = fake(behave)
      const fallback = vi.fn()
      openFolderDefault('C:\\x', fallback, run)
      await new Promise((done) => setTimeout(done, 0))
      expect(fallback).toHaveBeenCalledTimes(1)
      expect(fallback).toHaveBeenCalledWith('C:\\x')
    }
  })
})

// Perf review 2026-10-16: 300 stats at once on main's fs pool, no clock, and a
// mapped drive is stat'ed over SMB (diag log: term:path-kinds calls of 5-9 s).
describe("the painter's stats are metered", () => {
  const statLike = { isDirectory: () => false, isFile: () => true }

  it('never more than three in flight, however many are asked', async () => {
    let active = 0
    let most = 0
    const release: Array<() => void> = []
    const gate = createStatGate({
      stat: () => {
        active += 1
        most = Math.max(most, active)
        return new Promise((resolve) =>
          release.push(() => {
            active -= 1
            resolve(statLike)
          })
        )
      }
    })
    const all = pathKinds('C:\\w', Array.from({ length: 40 }, (_, i) => `f${i}.txt`), gate)
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 100 && (release.length || active); i += 1) {
      release.shift()?.()
      await new Promise((r) => setTimeout(r, 0))
    }
    const got = await all
    expect(most).toBe(3)
    expect(got.every((g) => g?.kind === 'file')).toBe(true)
  })

  it('a drive whose stat hangs answers nothing at once for a minute, and other drives go on', async () => {
    vi.useFakeTimers()
    try {
      const asked: string[] = []
      const gate = createStatGate({
        stat: (abs) => {
          asked.push(abs)
          return abs.startsWith('Z:') ? new Promise(() => {}) : Promise.resolve(statLike)
        }
      })
      const first = gate('Z:\\share\\a.txt')
      await vi.advanceTimersByTimeAsync(750)
      expect(await first).toBeNull()
      expect(await gate('Z:\\share\\b.txt')).toBeNull()
      expect(await gate('C:\\local.txt')).toBe('file')
      expect(asked).toEqual(['Z:\\share\\a.txt', 'C:\\local.txt'])
      await vi.advanceTimersByTimeAsync(60_000)
      void gate('Z:\\share\\c.txt')
      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toContain('Z:\\share\\c.txt')
    } finally {
      vi.useRealTimers()
    }
  })
})
