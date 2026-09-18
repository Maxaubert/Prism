import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanExplorerWindows,
  explorerWindowArgs,
  explorerWindowOwner,
  hasOtherExplorerWindows,
  markExplorerWindow
} from './explorerWindow'

const id = 'a1234567-1234-4567-89ab-123456789abc'
const other = 'b1234567-1234-4567-89ab-123456789abc'
const dirs: string[] = []
const profile = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'prism-windows-'))
  dirs.push(path)
  return path
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('independent Explorer windows', () => {
  it('blocks updates for live siblings or a child still starting, but not exited siblings', async () => {
    const owner = profile()
    markExplorerWindow(owner, false)
    expect(await hasOtherExplorerWindows(owner)).toBe(false)
    const child = join(owner, 'explorer-windows', id)
    mkdirSync(child, { recursive: true })
    expect(await hasOtherExplorerWindows(owner)).toBe(true)
    writeFileSync(
      join(child, 'prism-window.json'),
      JSON.stringify({ closed: false, pid: 2147483647 })
    )
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    expect(await hasOtherExplorerWindows(owner)).toBe(true)
    kill.mockImplementation(() => {
      throw Object.assign(new Error('Exited'), { code: 'ESRCH' })
    })
    expect(await hasOtherExplorerWindows(owner)).toBe(false)
  })
  it('gives each distinct request a different full profile and retains the ACK token', () => {
    const owner = profile()
    const opts = {
      owner,
      packaged: true,
      appPath: '/unused',
      argv: ['--preview', '--e2e', '--setup', 'private.txt']
    }
    const first = explorerWindowArgs({ ...opts, id })
    const second = explorerWindowArgs({ ...opts, id: other })
    expect(first.profile).not.toBe(second.profile)
    expect(first.profile).not.toBe(owner)
    expect(first.args).toEqual([
      `--user-data-dir=${first.profile}`,
      `--explorer-window=${id}`,
      `--win-e=${id}`,
      '--preview',
      '--e2e',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1'
    ])
    expect(explorerWindowOwner(first.profile, first.args)).toBe(owner)
  })
  it('does not interpret normal profiles or path traversal as managed windows', () => {
    const owner = profile()
    expect(explorerWindowOwner(owner, [`--explorer-window=${id}`])).toBeNull()
    expect(
      explorerWindowOwner(join(owner, 'unrelated', id), [`--explorer-window=${id}`])
    ).toBeNull()
    expect(() =>
      explorerWindowArgs({ owner, id: '../escape', packaged: true, appPath: '', argv: [] })
    ).toThrow()
  })
  it('preserves live and unclosed profiles during cleanup', async () => {
    const owner = profile()
    const child = join(owner, 'explorer-windows', id)
    mkdirSync(child, { recursive: true })
    markExplorerWindow(child, true)
    await cleanExplorerWindows(owner)
    expect(existsSync(child)).toBe(true)
    writeFileSync(
      join(child, 'prism-window.json'),
      JSON.stringify({ closed: false, pid: 2147483647 })
    )
    await cleanExplorerWindows(owner)
    expect(existsSync(child)).toBe(true)
  })
  it('cleans only closed, exited managed profiles', async () => {
    const owner = profile()
    const child = join(owner, 'explorer-windows', id)
    const unrelated = join(owner, 'explorer-windows', 'keep-me')
    for (const path of [child, unrelated]) {
      mkdirSync(path, { recursive: true })
      writeFileSync(
        join(path, 'prism-window.json'),
        JSON.stringify({ closed: true, pid: 2147483647 })
      )
    }
    await cleanExplorerWindows(owner)
    expect(existsSync(child)).toBe(false)
    expect(existsSync(unrelated)).toBe(true)
  })
})
