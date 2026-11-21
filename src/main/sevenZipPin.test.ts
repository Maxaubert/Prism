import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Audit #24 (2026-11-21): 7-Zip 25.00 follows a link inside an archive out of
// the extraction folder (CVE-2025-55188; fixed in 25.01). The bundled 7z.exe
// is pinned in tools/fetch-7zip.mjs and named in THIRD-PARTY-NOTICES.md.

const root = join(__dirname, '..', '..')
const script = readFileSync(join(root, 'tools', 'fetch-7zip.mjs'), 'utf8')
const notices = readFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8')

describe('bundled 7-Zip', () => {
  const asset = /const ASSET = '7z(\d)(\d\d)(\d)-x64\.msi'/.exec(script)
  // 7z2501 is 25.01; 7z2606 is 26.06
  const major = Number(`${asset?.[1]}${asset?.[2]?.[0] ?? ''}`)
  const minor = Number(`${asset?.[2]?.[1]}${asset?.[3]}`)

  it('is 25.01 or newer', () => {
    expect(asset).not.toBeNull()
    expect(major > 25 || (major === 25 && minor >= 1)).toBe(true)
  })
  it('is pinned by a SHA-256', () => {
    expect(/const SHA256 = '[0-9a-f]{64}'/.test(script)).toBe(true)
  })
  it('is the version the notices name', () => {
    const [, v] = /### 7-Zip (\d+\.\d+) \(/.exec(notices) ?? []
    expect(v).toBe(`${major}.${String(minor).padStart(2, '0')}`)
  })
})