import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureTermCore, resetTermCore, type TermApi, type TermHostConfig } from '../host'
import {
  findPath,
  forgetPathOwner,
  holdsCwd,
  linkRanges,
  onPathsFound,
  parentDir,
  pathCandidates,
  pathOwnersKept,
  resetPathCache,
  takeAsked
} from './termPathLinks'

const paths = (text: string): string[] => pathCandidates(text).map((p) => p.path)

describe('pathCandidates', () => {
  it('leaves the prompt alone, PowerShell and cmd', () => {
    expect(paths('PS C:\\Users\\me\\work> ls docs/a.pdf')).toEqual(['docs/a.pdf'])
    expect(paths('C:\\Users\\me\\work>dir')).toEqual([])
    // The same folder written in a sentence IS a path.
    expect(paths('it is in C:\\Users\\me\\work now')).toEqual(['C:\\Users\\me\\work'])
  })
  it('leaves a path inside a web link to the link', () => {
    expect(paths('see https://github.com/a/b/blob/main/README.md and README.md')).toEqual(['README.md'])
  })
})

// #167: a found path woke EVERY tab's painter, and each rescanned its whole
// scrollback (MEASURED in Stable's diag log, 2026-10-10 16:58Z: 2009 ms and
// 2046 ms page stacks in `scan` around a 2153 ms term:path-kinds). A found path
// is news only to the tab that asked about it.
describe('who hears that a path exists (#167)', () => {
  /** The paths that exist; every other one names nothing. */
  const real = new Set(['a.txt', 'b.txt'])
  let pending: Array<() => void> = []
  const ask = vi.fn((cwd: string, texts: string[]) => {
    void cwd
    return new Promise<Array<{ kind: 'file'; abs: string } | null>>((resolve) => {
      pending.push(() => resolve(texts.map((t) => (real.has(t) ? { kind: 'file', abs: `C:\\w\\${t}` } : null))))
    })
  })
  /** Main answers every batch it was asked, then the promises settle. */
  const answer = async (): Promise<void> => {
    const now = pending
    pending = []
    now.forEach((f) => f())
    await vi.advanceTimersByTimeAsync(0)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    pending = []
    ask.mockClear()
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
  })
  afterEach(() => {
    resetPathCache()
    resetTermCore()
    vi.useRealTimers()
  })

  it('a hit wakes the tab that asked, and no other', async () => {
    const a = vi.fn()
    const b = vi.fn()
    onPathsFound('A', a)
    onPathsFound('B', b)
    linkRanges('see a.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('a tab that asks for a path already in flight hears the answer too, once', async () => {
    const a = vi.fn()
    const b = vi.fn()
    onPathsFound('A', a)
    onPathsFound('B', b)
    linkRanges('see b.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(40) // A's batch is asked
    linkRanges('see b.txt', 'C:\\w', 'B') // ... and B asks while it is out
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('a path that names nothing wakes nobody', async () => {
    const a = vi.fn()
    onPathsFound('A', a)
    linkRanges('see nope.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })

  it('an unsubscribed listener hears nothing', async () => {
    const a = vi.fn()
    const off = onPathsFound('A', a)
    off()
    linkRanges('see a.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(a).not.toHaveBeenCalled()
  })

  it('takeAsked says once that a line queued a question, and not for a line fully known', async () => {
    linkRanges('see a.txt', 'C:\\w', 'A')
    expect(takeAsked('A')).toBe(true)
    expect(takeAsked('A')).toBe(false)
    expect(takeAsked('B')).toBe(false)
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(linkRanges('see a.txt', 'C:\\w', 'A')).toEqual([{ start: 4, end: 9, path: 'a.txt' }])
    expect(takeAsked('A')).toBe(false)
  })

  it('a line whose path is already being asked about still waits for it', async () => {
    linkRanges('see a.txt', 'C:\\w', 'A')
    takeAsked('A')
    await vi.advanceTimersByTimeAsync(40) // in flight now
    linkRanges('again a.txt', 'C:\\w', 'A')
    expect(takeAsked('A')).toBe(true)
  })
})

// Owner, 2026-10-15: Claude printed `dto-motion\a\out\a.mp4` in a tab whose
// folder was a repo, meaning a file under zz-Misc it had shown in full before.
describe('a relative path is tried in the folders the tab showed', () => {
  const REPO = 'C:\\c\\Github\\Repo'
  const MISC = 'C:\\c\\zz-Misc'
  /** The files that exist, by full path. */
  const files = new Set([`${MISC}\\dto\\b\\out\\b.mp4`, `${MISC}\\dto\\a\\out\\a.mp4`, `${MISC}\\dto\\b\\out\\notes.md`])
  const join = (base: string, t: string): string => (/^[A-Za-z]:/.test(t) ? t : `${base}\\${t}`)
  const ask = vi.fn(async (cwd: string, texts: string[]) =>
    texts.map((t) => (files.has(join(cwd, t)) ? { kind: 'file' as const, abs: join(cwd, t) } : null))
  )
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(50)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    ask.mockClear()
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
  })
  afterEach(() => {
    resetPathCache()
    resetTermCore()
    vi.useRealTimers()
  })

  it('parentDir climbs and stops at the drive', () => {
    expect(parentDir('C:\\a\\b\\')).toBe('C:\\a')
    expect(parentDir('C:\\a')).toBe(null)
    expect(parentDir('x')).toBe(null)
  })

  it('names nothing until a full path shows the folder, then lights up from three folders above it', async () => {
    const rel = 'see dto\\a\\out\\a.mp4 now'
    linkRanges(rel, REPO, 'A')
    await settle()
    expect(linkRanges(rel, REPO, 'A')).toEqual([])
    const woke = vi.fn()
    onPathsFound('A', woke)
    linkRanges(`at ${MISC}\\dto\\b\\out\\b.mp4.`, REPO, 'A')
    await settle()
    linkRanges(`at ${MISC}\\dto\\b\\out\\b.mp4.`, REPO, 'A')
    await settle()
    expect(woke).toHaveBeenCalled()
    linkRanges(rel, REPO, 'A')
    await settle()
    expect(linkRanges(rel, REPO, 'A')).toEqual([{ start: 4, end: 19, path: 'dto\\a\\out\\a.mp4' }])
    // A click resolves it in the folder it was found from.
    expect(findPath('A', REPO, 'dto\\a\\out\\a.mp4')?.base).toBe(MISC)
    // Another tab never showed that folder.
    linkRanges(rel, REPO, 'B')
    await settle()
    expect(linkRanges(rel, REPO, 'B')).toEqual([])
  })

  it('a bare name is tried in the shown folder only, never above it', async () => {
    const full = `at ${MISC}\\dto\\b\\out\\b.mp4`
    linkRanges(full, REPO, 'A')
    await settle()
    linkRanges(full, REPO, 'A')
    linkRanges('see notes.md', REPO, 'A')
    await settle()
    linkRanges('see notes.md', REPO, 'A')
    await settle()
    expect(findPath('A', REPO, 'notes.md')?.base).toBe(`${MISC}\\dto\\b\\out`)
    const bases = ask.mock.calls.filter(([, t]) => t.includes('notes.md')).map(([c]) => c)
    expect(bases).toEqual([REPO, `${MISC}\\dto\\b\\out`])
  })
})

// Owner, 2026-10-15: Claude Code's status line prints the tab's folder as
// `Github-loftspace/Stutter-Diagnostics`, which a shown folder above it found.
describe('the folder the tab is in is never a link found from a shown folder', () => {
  const ROOT = 'C:\\c'
  const CWD = 'C:\\c\\Github-loftspace\\Stutter'
  const dirs = new Set([ROOT, `${ROOT}\\Github-loftspace`, CWD, `${ROOT}\\Github`])
  const files = new Set([`${CWD}\\src\\a.ts`])
  const join = (base: string, t: string): string => (/^[A-Za-z]:/.test(t) ? t : `${base}\\${t.replace(/\//g, '\\')}`)
  const ask = vi.fn(async (cwd: string, texts: string[]) =>
    texts.map((t) => {
      const abs = join(cwd, t)
      return dirs.has(abs) ? { kind: 'dir' as const, abs } : files.has(abs) ? { kind: 'file' as const, abs } : null
    })
  )
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(50)
  }
  beforeEach(() => {
    vi.useFakeTimers()
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
  })
  afterEach(() => {
    resetPathCache()
    resetTermCore()
    vi.useRealTimers()
  })

  it('holdsCwd: the folder itself and those above it, either slash, any case', () => {
    expect(holdsCwd('C:\\c\\Github-loftspace\\Stutter', CWD)).toBe(true)
    expect(holdsCwd('c:/C/github-loftspace', CWD)).toBe(true)
    expect(holdsCwd('C:\\c\\Github', CWD)).toBe(false)
    expect(holdsCwd('C:\\c\\Github-loftspace\\Stutter\\src', CWD)).toBe(false)
  })

  it('the status line stays plain', async () => {
    const full = `see ${CWD}\\src\\a.ts`
    linkRanges(full, CWD, 'A')
    await settle()
    linkRanges(full, CWD, 'A')
    await settle()
    const status = 'Github-loftspace/Stutter (Sonnet 5.5)'
    for (let i = 0; i < 3; i += 1) {
      linkRanges(status, CWD, 'A')
      await settle()
    }
    expect(linkRanges(status, CWD, 'A')).toEqual([])
    expect(findPath('A', CWD, 'Github-loftspace/Stutter')).toBe(null)
  })

  // Owner, 2026-10-17: "the status line in claude still shows my path as a
  // link". Claude worked in a worktree BELOW the shell's folder, its status
  // line `worktrees/dictate-anywhere`, found from a shown `.claude` folder.
  it('the status line stays plain when Claude works in a folder inside the tab', async () => {
    const wtDirs = new Set([CWD, `${CWD}\\.claude`, `${CWD}\\.claude\\worktrees`, `${CWD}\\.claude\\worktrees\\wt`])
    const wtFiles = new Set([`${CWD}\\.claude\\notes.md`, `${CWD}\\.claude\\worktrees\\wt\\a.ts`])
    configureTermCore({
      api: {
        termPathKinds: vi.fn(async (cwd: string, texts: string[]) =>
          texts.map((t) => {
            const abs = join(cwd, t)
            return wtDirs.has(abs) ? { kind: 'dir' as const, abs } : wtFiles.has(abs) ? { kind: 'file' as const, abs } : null
          })
        )
      } as unknown as TermApi
    } as TermHostConfig)
    const shown = `see ${CWD}\\.claude\\notes.md`
    linkRanges(shown, CWD, 'A')
    await settle()
    linkRanges(shown, CWD, 'A')
    await settle()
    const status = 'worktrees/wt (Opus 5.5)'
    for (let i = 0; i < 3; i += 1) {
      linkRanges(status, CWD, 'A')
      await settle()
    }
    expect(linkRanges(status, CWD, 'A')).toEqual([])
    // A FILE there is still a link.
    const file = 'worktrees/wt/a.ts'
    for (let i = 0; i < 3; i += 1) {
      linkRanges(file, CWD, 'A')
      await settle()
    }
    expect(linkRanges(file, CWD, 'A').length).toBe(1)
  })
})

// 2026-10-16: every Claude tab in the owner's Stable copy stopped taking keys
// and scrolls, the page process at 15.9 GB and growing. A tab showing five or
// more folders taught one that had been pushed out of the four kept on every
// paint, and each teaching woke the tab to paint again: forever.
describe('a tab showing many folders settles', () => {
  afterEach(() => {
    resetPathCache()
    resetTermCore()
    vi.useRealTimers()
  })

  it('wakes once per folder, then stops, however many folders it shows', async () => {
    vi.useFakeTimers()
    const ask = vi.fn(async (_cwd: string, texts: string[]) => texts.map((t) => ({ kind: 'file' as const, abs: t })))
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
    const lines = Array.from({ length: 9 }, (_, n) => `see C:\\d${n}\\f.txt and rel\\x.txt`)
    let wakes = 0
    // The painter: a wake repaints every line, as links.revisit() does.
    onPathsFound('A', () => {
      wakes += 1
      if (wakes < 1000) lines.forEach((l) => linkRanges(l, 'C:\\cwd', 'A'))
    })
    lines.forEach((l) => linkRanges(l, 'C:\\cwd', 'A'))
    for (let i = 0; i < 100; i += 1) await vi.advanceTimersByTimeAsync(50)
    const settled = wakes
    for (let i = 0; i < 100; i += 1) await vi.advanceTimersByTimeAsync(50)
    expect(wakes).toBe(settled)
    // One for the answer, one per folder taught: never more.
    expect(wakes).toBeLessThanOrEqual(1 + lines.length)
  })
})

// Perf review 2026-10-16: main answers the first 300 of a call, and every path
// past the 300th was cached as "does not exist".
describe('a long list is asked in pieces main answers whole', () => {
  afterEach(() => {
    resetPathCache()
    resetTermCore()
    vi.useRealTimers()
  })

  it('asks 300 at a time, one piece after the other, and the 400th lights up', async () => {
    vi.useFakeTimers()
    let flying = 0
    let most = 0
    const ask = vi.fn(async (_cwd: string, texts: string[]) => {
      flying += 1
      most = Math.max(most, flying)
      await Promise.resolve()
      flying -= 1
      // Main's own cap: it never answers past 300.
      return texts.slice(0, 300).map((t) => ({ kind: 'file' as const, abs: `C:\\w\\${t}` }))
    })
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
    const text = Array.from({ length: 650 }, (_, n) => `f${n}.txt`).join(' ')
    linkRanges(text, 'C:\\w', 'A')
    for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(50)
    expect(ask.mock.calls.map((c) => c[1].length)).toEqual([300, 300, 50])
    expect(most).toBe(1)
    expect(findPath('A', 'C:\\w', 'f400.txt')?.hit.abs).toBe('C:\\w\\f400.txt')
  })

  it('a short answer is never read past its end as "missing"', async () => {
    vi.useFakeTimers()
    const ask = vi.fn(async () => [{ kind: 'file' as const, abs: 'C:\\w\\a.txt' }])
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
    linkRanges('a.txt b.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(50)
    expect(findPath('A', 'C:\\w', 'a.txt')?.hit.kind).toBe('file')
    expect(findPath('A', 'C:\\w', 'b.txt')).toBeUndefined()
  })
})

// Perf review 2026-10-16: a closed tab's anchors and taught folders were kept.
describe('a closed tab is forgotten', () => {
  afterEach(() => {
    resetPathCache()
    resetTermCore()
    vi.useRealTimers()
  })

  it('forgetPathOwner drops what the tab taught and waits on', async () => {
    vi.useFakeTimers()
    const ask = vi.fn(async (_cwd: string, texts: string[]) => texts.map((t) => ({ kind: 'file' as const, abs: t })))
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
    linkRanges('see C:\\d\\f.txt', 'C:\\cwd', 'A')
    await vi.advanceTimersByTimeAsync(50)
    linkRanges('see C:\\d\\f.txt and rel\\x.txt', 'C:\\cwd', 'A')
    expect(pathOwnersKept()).toBe(1)
    forgetPathOwner('A')
    expect(pathOwnersKept()).toBe(0)
  })
})

// Owner, 2026-10-21: a long path Claude printed was not a link. Claude Code
// breaks its own lines at the window's width, so the rows `C:\...\scrat` and
// `chpad\...\Flare-win-Setup.exe` each named nothing.
describe('a path broken by hand at the edge is read across the break', () => {
  const EXE = 'C:\\t\\scratchpad\\flare-pack\\Flare-win-Setup.exe'
  const files = new Set([EXE, 'C:\\t\\a.txt'])
  const ask = vi.fn(async (_cwd: string, texts: string[]) =>
    texts.map((t) => (files.has(t) ? { kind: 'file' as const, abs: t } : null))
  )
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(50)
  }
  const ranges = async (text: string, joins: number[]): Promise<Array<{ start: number; end: number }>> => {
    linkRanges(text, 'C:\\w', 'A', joins)
    await settle()
    return linkRanges(text, 'C:\\w', 'A', joins).map(({ start, end }) => ({ start, end }))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    ask.mockClear()
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
  })
  afterEach(() => {
    resetPathCache()
    resetTermCore()
    vi.useRealTimers()
  })

  it('one link over both rows, and neither half alone', async () => {
    const top = '- Location: C:\\t\\scrat'
    const text = `${top}chpad\\flare-pack\\Flare-win-Setup.exe`
    expect(await ranges(text, [top.length])).toEqual([{ start: 12, end: text.length }])
    // Without the break known, the halves are all there is: no link.
    resetPathCache()
    expect(await ranges(text.slice(0, top.length), [])).toEqual([])
  })

  it('a path that ends at the edge keeps its link when the joined text names nothing', async () => {
    const top = 'see C:\\t\\a.txt'
    expect(await ranges(`${top}\\more`, [top.length])).toEqual([{ start: 4, end: top.length }])
  })

  it('a web link is never carried across the break', () => {
    const top = 'go https://a.io/x'
    expect(linkRanges(`${top}/y/z`, 'C:\\w', 'A', [top.length])).toEqual([{ start: 3, end: top.length }])
    expect(pathCandidates(`${top}/y/z`, undefined, [top.length]).map((c) => c.path)).toEqual(['/y/z'])
  })
})
