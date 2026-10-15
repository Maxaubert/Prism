import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { createFolderHandler } from './folderHandler'

const EXE = 'C:\\Prism test\\Prism.exe'
const PROFILE = 'C:\\profile & test'
const off = { on: false, current: false }
const mine = { on: true, current: true }
const elsewhere = { on: true, current: false }

function setup(states: unknown[], options: { supported?: boolean } = {}) {
  const marker = join(mkdtempSync(join(tmpdir(), 'folders-')), 'folders-on')
  const runner = vi.fn(async () => {
    const next = states.shift()
    if (next instanceof Error) throw next
    return JSON.stringify(next)
  })
  const service = createFolderHandler({
    helper: 'helper.exe',
    executable: EXE,
    profile: PROFILE,
    supported: options.supported ?? true,
    marker,
    exists: () => true,
    runner
  })
  return { runner, service, marker }
}

describe('Open folders in Prism (#393)', () => {
  it('writes nothing at startup for somebody who never turned it on', async () => {
    const { runner, service } = setup([])
    await service.repair()
    expect(runner).not.toHaveBeenCalled()
  })

  it('turning on remembers the choice, enables for this Prism and reads it back', async () => {
    const { runner, service, marker } = setup([mine, mine])
    expect(await service.set(true)).toEqual({ available: true, on: true, mine: true })
    expect(existsSync(marker)).toBe(true)
    expect(runner).toHaveBeenNthCalledWith(1, 'helper.exe', ['--folders-enable', EXE, PROFILE])
    expect(runner).toHaveBeenNthCalledWith(2, 'helper.exe', ['--folders-status', EXE, PROFILE])
  })

  it('turning off forgets the choice and disables without naming a Prism', async () => {
    const { runner, service, marker } = setup([mine, mine, off, off])
    await service.set(true)
    expect(await service.set(false)).toEqual({ available: true, on: false, mine: false })
    expect(existsSync(marker)).toBe(false)
    expect(runner).toHaveBeenNthCalledWith(3, 'helper.exe', ['--folders-disable'])
  })

  it('repairs a registration left pointing elsewhere, only when chosen', async () => {
    const { runner, service } = setup([mine, mine, elsewhere, mine])
    await service.set(true)
    await service.repair()
    expect(runner).toHaveBeenNthCalledWith(4, 'helper.exe', ['--folders-enable', EXE, PROFILE])
  })

  it('leaves a current registration alone at startup', async () => {
    const { runner, service } = setup([mine, mine, mine])
    await service.set(true)
    await service.repair()
    expect(runner).toHaveBeenCalledTimes(3)
  })

  it('another Prism owning the handler reads as on but not this one', async () => {
    const { service } = setup([elsewhere])
    expect(await service.status()).toEqual({ available: true, on: true, mine: false })
  })

  it('says so when Windows does not confirm the change', async () => {
    const { service } = setup([off, off])
    expect((await service.set(true)).error).toBe('The folder setting could not be confirmed.')
  })

  it('passes the helper error through and never claims success', async () => {
    const { service } = setup([{ ...off, error: 'Prism is missing.' }])
    expect(await service.set(true)).toEqual({ available: true, on: false, mine: false, error: 'Prism is missing.' })
  })

  it('a broken helper reply is an error, not off', async () => {
    const { service } = setup([new Error('boom')])
    expect((await service.status()).error).toBe('Windows could not confirm the folder setting.')
  })

  it('does nothing at all outside a packaged Windows build', async () => {
    const { runner, service, marker } = setup([], { supported: false })
    expect((await service.set(true)).available).toBe(false)
    await service.repair()
    expect(runner).not.toHaveBeenCalled()
    expect(existsSync(marker)).toBe(false)
  })
})
