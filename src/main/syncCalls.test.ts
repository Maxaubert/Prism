import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

// The main process never waits on the disk or on another program while the user
// works (owner, 2026-10-12, after a 3.9 s freeze traced to a writeFileSync of
// tabs.json). Every synchronous call in src/main (anything named `*Sync(`, which
// covers readFileSync, existsSync, execSync, execFileSync, spawnSync and
// realpathSync.native) must either be converted to fs/promises or carry a
// `// sync-ok: <reason>` comment on its line or the line above. A reason is
// valid only for startup (before the first window shows), quit, a worker
// thread or child process, or an answer that is synchronous by design (a
// sendSync IPC, the root wall's path check, adm-zip). Code inside a Worker's
// eval source counts too: it is code, so it carries the marker as well.

const MAIN = __dirname
const CORE_MAIN = join(MAIN, '..', '..', 'packages', 'term-core', 'main')
const SKIP_DIRS = [join(MAIN, 'phone', 'testing')]

function sources(dir: string): string[] {
  if (SKIP_DIRS.includes(dir)) return []
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** The source with comments and plain '...' / "..." strings blanked (newlines
 *  kept, so line numbers hold). Template literals stay: a Worker's eval source
 *  is a template and it is code. A `/` that starts a regex literal is not
 *  tracked; none of main's regexes hold a quote or `//` that would confuse it. */
function codeOnly(src: string): string {
  let out = ''
  let i = 0
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      out += blank(src.slice(i, stop))
      i = stop
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += blank(src.slice(i, stop))
      i = stop
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      out += c + blank(src.slice(i + 1, j)) + (src[j] ?? '')
      i = j + 1
    } else {
      out += c
      i++
    }
  }
  return out
}

const CALL = /\b[A-Za-z]+Sync(?:\.native)?\s*\(/g

/** Every unmarked synchronous call in one file's source, as 1-based lines. */
function unmarkedSyncCalls(src: string): number[] {
  const raw = src.split('\n')
  const code = codeOnly(src).split('\n')
  const hits: number[] = []
  code.forEach((line, i) => {
    for (const m of line.matchAll(CALL)) {
      // A declaration (`function readThingSync(`) is not a call.
      if (/function\s*$/.test(line.slice(0, m.index))) continue
      if (raw[i].includes('sync-ok:') || (i > 0 && raw[i - 1].includes('sync-ok:'))) continue
      hits.push(i + 1)
      break
    }
  })
  return hits
}

describe('unmarkedSyncCalls', () => {
  it('finds a bare call and accepts one marked on its line or the line above', () => {
    const src = [
      "readFileSync('a')",
      "existsSync('b') // sync-ok: startup",
      '// sync-ok: quit',
      "fs.writeFileSync('c', '')",
      "realpathSync.native('d')"
    ].join('\n')
    expect(unmarkedSyncCalls(src)).toEqual([1, 5])
  })

  it('ignores comments, plain strings and declarations, but not template code', () => {
    const src = [
      '// readFileSync(x) in a comment',
      "const s = 'execSync(x)'",
      '/* spawnSync(',
      ') */ function statSync(p: string) {}',
      'new Worker(`require("fs").readdirSync(p)`, { eval: true })'
    ].join('\n')
    expect(unmarkedSyncCalls(src)).toEqual([5])
  })
})

describe('main never waits (2026-10-12)', () => {
  it('every synchronous call in src/main and the core\'s main carries a sync-ok reason', () => {
    const bad: string[] = []
    // The terminal core's main-process code runs in this same process (Phase 2 of
    // moving the core in), so it keeps the same rule.
    for (const [dir, label] of [
      [MAIN, 'src/main'],
      [CORE_MAIN, 'packages/term-core/main']
    ] as const) {
      for (const file of sources(dir)) {
        const rel = relative(dir, file).replace(/\\/g, '/')
        for (const line of unmarkedSyncCalls(readFileSync(file, 'utf8'))) bad.push(`${label}/${rel}:${line}`)
      }
    }
    expect(bad, `convert these to fs/promises, or mark a genuine startup / quit / worker / sync-by-design call with "// sync-ok: <reason>":\n${bad.join('\n')}`).toEqual([])
  })
})
