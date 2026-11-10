import { afterEach, describe, expect, it, vi } from 'vitest'

/** The e2e seam (D22): `PRISM_E2E_BIN_DIRS` stands in for the drives' bins, but only under `--e2e`. */
describe('binDirs', () => {
  const argv = [...process.argv]
  afterEach(() => {
    process.argv = [...argv]
    delete process.env.PRISM_E2E_BIN_DIRS
    vi.resetModules()
  })

  it('returns the seam folders under --e2e', async () => {
    process.argv = [...argv, '--e2e']
    process.env.PRISM_E2E_BIN_DIRS = 'C:\\fx\\a\\$Recycle.Bin\\S-1|D:\\fx\\b\\$Recycle.Bin\\S-1'
    const { binDirs } = await import('./binRoots')
    expect(await binDirs()).toEqual(['C:\\fx\\a\\$Recycle.Bin\\S-1', 'D:\\fx\\b\\$Recycle.Bin\\S-1'])
  })

  it('ignores the variable without --e2e', async () => {
    process.argv = argv.filter((a) => a !== '--e2e')
    process.env.PRISM_E2E_BIN_DIRS = 'C:\\fx\\a\\$Recycle.Bin\\S-1'
    const { binDirs } = await import('./binRoots')
    expect(await binDirs()).not.toContain('C:\\fx\\a\\$Recycle.Bin\\S-1')
  })

  it('PRISM_E2E_SLOW_BIN is a per-item delay under --e2e only, capped', async () => {
    process.env.PRISM_E2E_SLOW_BIN = '40'
    process.argv = argv.filter((a) => a !== '--e2e')
    expect((await import('./binRoots')).slowBinMs()).toBe(0)
    process.argv = [...argv, '--e2e']
    expect((await import('./binRoots')).slowBinMs()).toBe(40)
    process.env.PRISM_E2E_SLOW_BIN = '999999'
    expect((await import('./binRoots')).slowBinMs()).toBe(5000)
    process.env.PRISM_E2E_SLOW_BIN = 'abc'
    expect((await import('./binRoots')).slowBinMs()).toBe(0)
    delete process.env.PRISM_E2E_SLOW_BIN
  })

  // Undo's restore falls back to PowerShell's Shell.Application, which reads the
  // owner's REAL bin. Under the seam it must not: the fallback is refused.
  it('the shell fallback is allowed only when there is no seam', async () => {
    process.argv = argv.filter((a) => a !== '--e2e')
    process.env.PRISM_E2E_BIN_DIRS = 'C:\\fx\\ok'
    expect((await import('./binRoots')).shellBinAllowed()).toBe(true)
    process.argv = [...argv, '--e2e']
    vi.resetModules()
    expect((await import('./binRoots')).shellBinAllowed()).toBe(false)
    delete process.env.PRISM_E2E_BIN_DIRS
    vi.resetModules()
    expect((await import('./binRoots')).shellBinAllowed()).toBe(true)
  })

  it('drops a seam entry that is not absolute', async () => {
    process.argv = [...argv, '--e2e']
    process.env.PRISM_E2E_BIN_DIRS = 'relative\\bin|C:\\fx\\ok'
    const { binDirs } = await import('./binRoots')
    expect(await binDirs()).toEqual(['C:\\fx\\ok'])
  })
})
