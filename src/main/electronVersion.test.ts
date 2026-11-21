import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Audit #25 (2026-11-21): the shipped Chromium and Node are the Electron in
// the lock file. It stays on the 43 line, at 43.8.12 or newer.

const root = join(__dirname, '..', '..')
const parts = (v: string): number[] => v.replace(/^[^\d]*/, '').split('.').map(Number)

describe('electron', () => {
  it('is locked at 43.8.12 or newer, still on major 43', () => {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version: string }>
    }
    const [major, minor, patch] = parts(lock.packages['node_modules/electron'].version)
    expect(major).toBe(43)
    expect(minor > 8 || (minor === 8 && patch >= 12)).toBe(true)
  })
  it('asks for it in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    const [major, minor, patch] = parts(pkg.devDependencies.electron)
    expect(major).toBe(43)
    expect(minor > 8 || (minor === 8 && patch >= 12)).toBe(true)
  })
})