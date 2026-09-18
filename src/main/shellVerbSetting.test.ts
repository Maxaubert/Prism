import { describe, expect, it, vi } from 'vitest'
import { createShellVerbSetting } from './shellVerbSetting'

function fixture(automatic = true) {
  const state = { present: false, owned: false, off: false }
  const deps = {
    saidNo: vi.fn(async () => state.off),
    remember: vi.fn(async (on: boolean) => {
      state.off = !on
    }),
    registered: vi.fn(async () => state.present),
    installed: vi.fn(async () => state.owned),
    install: vi.fn(async () => {
      state.present = state.owned = true
      return true
    }),
    remove: vi.fn(async () => {
      state.present = state.owned = false
      return true
    })
  }
  const setting = createShellVerbSetting({ exe: 'Prism.exe', marker: 'unused', automatic }, deps)
  return { state, deps, setting }
}

describe('Explorer menu setting', () => {
  it('repairs the default before returning the first Settings status', async () => {
    const { setting, deps } = fixture()
    expect(await setting.status()).toBe(true)
    expect(deps.install).toHaveBeenCalledOnce()
    expect(deps.installed).toHaveBeenCalledOnce()
  })

  it('honors a saved explicit off after restart', async () => {
    const { state, setting, deps } = fixture()
    state.off = true
    expect(await setting.status()).toBe(false)
    expect(deps.install).not.toHaveBeenCalled()
  })

  it('reports another valid installed copy without repointing it', async () => {
    const { state, setting, deps } = fixture()
    state.present = true
    expect(await setting.status()).toBe(true)
    expect(deps.install).not.toHaveBeenCalled()
    expect(state.owned).toBe(false)
  })

  it('does not register previews or development builds automatically', async () => {
    const { setting, deps, state } = fixture(false)
    expect(await setting.status()).toBe(false)
    expect(deps.install).not.toHaveBeenCalled()
    state.present = true
    expect(await setting.status()).toBe(true)
    expect(deps.install).not.toHaveBeenCalled()
  })

  it('allows an explicit preview enable to take ownership and clears the off marker', async () => {
    const { setting, state } = fixture(false)
    state.off = true
    expect(await setting.set(true)).toBe(true)
    expect(state).toEqual({ present: true, owned: true, off: false })
  })

  it('serializes a slow startup repair before a later explicit disable', async () => {
    const { setting, state, deps } = fixture()
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    deps.install.mockImplementationOnce(async () => {
      await gate
      state.present = state.owned = true
      return true
    })
    const startup = setting.status()
    const off = setting.set(false)
    const settingsRead = setting.status()
    await vi.waitFor(() => expect(deps.install).toHaveBeenCalledOnce())
    expect(deps.remove).not.toHaveBeenCalled()
    finish()
    expect(await startup).toBe(true)
    expect(await off).toBe(true)
    expect(await settingsRead).toBe(false)
    expect(state).toEqual({ present: false, owned: false, off: true })
  })

  it('keeps the last rapid toggle and its persisted intent', async () => {
    const { setting, state } = fixture()
    await Promise.all([setting.set(true), setting.set(false), setting.set(true)])
    expect(await setting.status()).toBe(true)
    expect(state.off).toBe(false)
  })

  it('does not change the registry if remembering the preference fails', async () => {
    const { setting, deps } = fixture()
    deps.remember.mockRejectedValueOnce(new Error('Access denied'))
    expect(await setting.set(true)).toBe(false)
    expect(deps.install).not.toHaveBeenCalled()
    expect(await setting.set(true)).toBe(true)
  })

  it('does not report an unverified registration as enabled', async () => {
    const { setting, deps } = fixture()
    deps.installed.mockResolvedValue(false)
    expect(await setting.status()).toBe(false)
    expect(await setting.set(true)).toBe(false)
  })
})
