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

  it('drops a seam entry that is not absolute', async () => {
    process.argv = [...argv, '--e2e']
    process.env.PRISM_E2E_BIN_DIRS = 'relative\\bin|C:\\fx\\ok'
    const { binDirs } = await import('./binRoots')
    expect(await binDirs()).toEqual(['C:\\fx\\ok'])
  })
})
