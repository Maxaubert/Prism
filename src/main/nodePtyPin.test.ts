import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The terminal's shells need node-pty 1.2.0-beta.15 (Prism Terminal #127/#128):
// 1.1.0's exit threads race on an unlocked vector and its prebuild asserts
// ("Assertion failed! remove_pty_baton"), a modal dialog that holds the app
// open when shells close together. Prism never took the pin; PT lost it in a
// merge and the owner saw the dialog again (PT #159). This catches it every run.
const PIN = '1.2.0-beta.15'
const root = join(__dirname, '..', '..')
interface Pkg {
  dependencies: Record<string, string>
  packages: Record<string, { version: string }>
}
const json = (f: string): Pkg => JSON.parse(readFileSync(join(root, f), 'utf8')) as Pkg

describe('node-pty pin (PT #159)', () => {
  it('package.json asks for exactly the pinned build', () => {
    const pkg = json('package.json')
    expect(pkg.dependencies['node-pty']).toBe(PIN)
    expect(JSON.stringify(pkg)).not.toContain('node-pty@1.1.0')
  })

  it('the lockfile resolves it', () => {
    expect(json('package-lock.json').packages['node_modules/node-pty'].version).toBe(PIN)
  })
})
