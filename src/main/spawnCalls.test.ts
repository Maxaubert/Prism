import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative, sep } from 'path'

// MAIN NEVER STARTS A PROCESS ITSELF (2026-10-27, spawnWorker.ts): starting one
// is synchronous on the thread that starts it and has frozen main for seconds
// (#351). Only `spawnWorker.ts` and Worker sources may reach `child_process`;
// a module that STREAMS from a long-lived child (ffmpeg, 7-Zip progress) or
// watches one it launched says why with `// spawn-ok: <reason>` on the import's
// line or the line above. Type-only imports start nothing and pass.

const MAIN = __dirname
const ALLOWED = new Set(['spawnWorker.ts', 'driveUsage.ts', 'dwmHelper.ts'])

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

describe('main starts no process on its own thread', () => {
  it('reaches child_process only through the spawn worker or with a reason', () => {
    const offenders: string[] = []
    for (const file of sources(MAIN)) {
      const rel = relative(MAIN, file).split(sep).join('/')
      if (ALLOWED.has(rel) || rel.startsWith('phone/testing/')) continue
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!/from ['"](node:)?child_process['"]|require\(['"](node:)?child_process['"]\)/.test(line)) return
        if (/^\s*import type /.test(line) || /import\(['"]child_process['"]\)/.test(line)) return
        if (/spawn-ok:/.test(line) || /spawn-ok:/.test(lines[i - 1] ?? '')) return
        offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
