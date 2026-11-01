import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, relative, resolve, sep } from 'path'
import { PROCESS_TESTS } from '../../vitest.config'

// A TEST THAT STARTS A REAL POWERSHELL RUNS IN THE PROCESS GROUP (release unit
// flakes, 2026-11-01; held by this test since the review the same day). Beside
// 300 other files on a four-core runner, PowerShell took 9 s to echo a line,
// so those files run last, one at a time (`PROCESS_TESTS`, vitest.config.ts).
// A test file that starts PowerShell's program or calls `powershellInWorker`
// is in that list, or says why it may stay out with `// process-ok: <reason>`
// on the line or the line above (a test gated to its own CI step).

const ROOT = resolve(__dirname, '../..')
const SELF = 'src/main/processTests.test.ts'
// The program as an argument (`spawn('powershell.exe', [...])`), not a name in
// a string, a fake's match or a language list.
const STARTS = /['"`]powershell(\.exe)?['"`]\s*,|powershellInWorker\(/i

function tests(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tests(p))
    else if (/\.test\.(ts|tsx|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

describe('the real-PowerShell tests run in the process group', () => {
  it('lists every test file that starts PowerShell, or it says why not', () => {
    const listed = new Set(PROCESS_TESTS)
    const offenders: string[] = []
    for (const top of ['src', 'packages/term-core', 'tools/lib']) {
      for (const file of tests(join(ROOT, top))) {
        const rel = relative(ROOT, file).split(sep).join('/')
        if (rel === SELF || listed.has(rel)) continue
        const lines = readFileSync(file, 'utf8').split(/\r?\n/)
        lines.forEach((line, i) => {
          if (!STARTS.test(line)) return
          if (/process-ok:/.test(line) || /process-ok:/.test(lines[i - 1] ?? '')) return
          offenders.push(`${rel}:${i + 1}`)
        })
      }
    }
    expect(offenders).toEqual([])
  })

  it('lists only files that are there', () => {
    expect(PROCESS_TESTS.filter((f) => !existsSync(join(ROOT, f)))).toEqual([])
  })
})
