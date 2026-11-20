import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative, sep } from 'path'
import { powershellExe, systemExe } from './systemBin'

// Windows' own programs start by FULL PATH (audit #1, owner 2026-11-20): a bare
// name is searched in the folder Prism was started from first.

const MAIN = __dirname

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

describe('systemBin', () => {
  it('builds full paths under System32', () => {
    const old = process.env.SystemRoot
    process.env.SystemRoot = 'D:\\Win'
    try {
      expect(systemExe('reg.exe')).toBe(join('D:\\Win', 'System32', 'reg.exe'))
      expect(powershellExe()).toBe(join('D:\\Win', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    } finally {
      if (old === undefined) delete process.env.SystemRoot
      else process.env.SystemRoot = old
    }
  })
})

describe('no bare system program name in src/main', () => {
  // A string literal as the program of spawn / execFile / launch / run / spawnStream.
  const call = /\b(?:spawn|spawnStream|execFile|launch|run|exec|execSync|spawnSync|execFileSync)\(\s*([\x27"\x60])([^\x27"\x60/\\]+)\1/g
  // Windows programs that must only ever appear through systemExe / powershellExe.
  const system = /([\x27"\x60])(?:(?:reg|where|rundll32|powershell|cmd|whoami|explorer|taskkill|tasklist|wscript|cscript|mshta|schtasks|icacls|attrib|wmic|cleanmgr|msiexec|net|sc)\.exe|powershell|cmd)\1/gi

  it('passes no bare program name to a process call', () => {
    const offenders: string[] = []
    for (const file of sources(MAIN)) {
      const rel = relative(MAIN, file).split(sep).join('/')
      if (rel === 'spawnWorker.ts') continue
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(call)) offenders.push(rel + ': ' + m[0].replace(/\s+/g, ' '))
    }
    expect(offenders).toEqual([])
  })

  it('names a system program only inside systemExe()', () => {
    const offenders: string[] = []
    for (const file of sources(MAIN)) {
      const rel = relative(MAIN, file).split(sep).join('/')
      if (rel === 'systemBin.ts') continue
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(system)) {
        const before = text.slice(Math.max(0, m.index! - 12), m.index!)
        if (/systemExe\(\s*$/.test(before)) continue
        // Prose and type tags that merely share a word ('powershell' as a clipboard route).
        const line = text.slice(text.lastIndexOf('\n', m.index!) + 1, text.indexOf('\n', m.index!))
        if (/^\s*(\*|\/\/|\/\*)|via:/.test(line)) continue
        offenders.push(rel + ': ' + line.trim())
      }
    }
    expect(offenders).toEqual([])
  })
})