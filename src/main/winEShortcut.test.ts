import { describe, expect, it, vi } from 'vitest'
import { createWinEShortcut } from './winEShortcut'

const off = { enabled: false, running: false, conflict: false }
const on = { ...off, enabled: true, running: true }
function setup(states: unknown[]) {
  const runner = vi.fn(async () => {
    const next = states.shift()
    if (next instanceof Error) throw next
    return JSON.stringify(next)
  })
  return {
    runner,
    service: createWinEShortcut({
      helper: 'helper.exe',
      executable: 'C:\\Prism test\\Prism.exe',
      profile: 'C:\\profile & test',
      supported: true,
      exists: () => true,
      runner
    })
  }
}
describe('Win+E setting', () => {
  it('does not register anything on default-off startup', async () => {
    const { runner, service } = setup([off])
    await service.resume()
    expect(runner.mock.calls).toHaveLength(1)
    expect(runner).toHaveBeenCalledWith('helper.exe', [
      '--status',
      'C:\\Prism test\\Prism.exe',
      'C:\\profile & test'
    ])
  })
  it('restarts only an already opted-in stopped helper', async () => {
    const { runner, service } = setup([{ ...on, running: false }, on, on])
    await service.resume()
    expect(runner.mock.calls).toHaveLength(3)
    expect(runner).toHaveBeenNthCalledWith(2, 'helper.exe', [
      '--enable',
      'C:\\Prism test\\Prism.exe',
      'C:\\profile & test'
    ])
  })
  it('never overwrites another installation on startup', async () => {
    const { runner, service } = setup([{ ...off, conflict: true }])
    await service.resume()
    expect(runner).toHaveBeenCalledTimes(1)
  })
  it('serializes enable and disable and verifies both readbacks', async () => {
    const { runner, service } = setup([on, on, off, off])
    const results = await Promise.all([service.set(true), service.set(false)])
    expect(results).toEqual([
      { ...on, available: true },
      { ...off, available: true }
    ])
    expect(runner.mock.calls.map((call) => (call as unknown as [string, string[]])[1][0])).toEqual([
      '--enable',
      '--status',
      '--disable',
      '--status'
    ])
  })
  it('reports a false enable readback instead of claiming success', async () => {
    const { service } = setup([on, off])
    expect(await service.set(true)).toMatchObject({ enabled: false, error: expect.any(String) })
  })
  it('reads actual state after failed disable, retaining known state if read also fails', async () => {
    const { service } = setup([on, new Error('timeout'), new Error('timeout')])
    await service.status()
    expect(await service.set(false)).toMatchObject({
      enabled: true,
      running: true,
      error: expect.any(String)
    })
  })
  it('preserves structured helper errors and confirmed ownership', async () => {
    const { service } = setup([{ ...on, error: 'Stop failed' }, on])
    expect(await service.set(false)).toEqual({ ...on, available: true, error: 'Stop failed' })
  })
  it('rejects malformed output and never invokes helpers for unsupported builds', async () => {
    const { service, runner } = setup([{ enabled: 'yes' }])
    expect(await service.status()).toMatchObject({ error: expect.any(String) })
    runner.mockClear()
    const unsupported = createWinEShortcut({
      helper: '',
      executable: '',
      profile: '',
      supported: false,
      runner
    })
    expect(await unsupported.set(true)).toMatchObject({ enabled: false, available: false })
    expect(runner).not.toHaveBeenCalled()
  })
})
