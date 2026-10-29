import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { OLD_EXPLORER_WINDOWS, removeOldExplorerWindows } from './oldExplorerWindows'

const id = 'a1234567-1234-4567-89ab-123456789abc'
const dirs: string[] = []
const profile = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'prism-old-windows-'))
  dirs.push(path)
  return path
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Tab tear-off step 2 (2026-10-29): Win+E windows are windows of this process
// now, and the profiles the old second processes kept are cleaned up once.
describe("the retired Win+E windows' profiles", () => {
  it('removes every old window profile, the marker, and the emptied folder', async () => {
    const owner = profile()
    const child = join(owner, OLD_EXPLORER_WINDOWS, id)
    mkdirSync(join(child, 'Local Storage'), { recursive: true })
    writeFileSync(join(child, 'prism-window.json'), '{"pid":1,"closed":true}')
    writeFileSync(join(owner, 'prism-window.json'), '{"pid":1,"closed":false}')
    writeFileSync(join(owner, 'tabs.json'), '{}')
    await removeOldExplorerWindows(owner)
    expect(existsSync(join(owner, OLD_EXPLORER_WINDOWS))).toBe(false)
    expect(existsSync(join(owner, 'prism-window.json'))).toBe(false)
    // Nothing else in the profile is touched.
    expect(existsSync(join(owner, 'tabs.json'))).toBe(true)
  })
  it('leaves what is not an old window profile, and the folder holding it', async () => {
    const owner = profile()
    const keep = join(owner, OLD_EXPLORER_WINDOWS, 'keep-me')
    mkdirSync(keep, { recursive: true })
    mkdirSync(join(owner, OLD_EXPLORER_WINDOWS, id), { recursive: true })
    await removeOldExplorerWindows(owner)
    expect(existsSync(keep)).toBe(true)
    expect(existsSync(join(owner, OLD_EXPLORER_WINDOWS, id))).toBe(false)
  })
  it('has nothing to do once they have gone', async () => {
    await expect(removeOldExplorerWindows(profile())).resolves.toBeUndefined()
  })
})
