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
    }),
    relabel: vi.fn(async () => true)
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

  /**
   * Relabelling (2026-09-19, #167). The labels changed ("Open file", "Open as
   * project") and a working verb is otherwise left alone, so an existing
   * install would carry the old text for ever. `relabelVerb` holds the rule
   * about WHICH entries may be touched (on, this exe, stale); what is tested
   * here is WHEN it is allowed to run at all.
   */
  it('relabels an existing registration at launch', async () => {
    const { state, setting, deps } = fixture()
    state.present = state.owned = true
    expect(await setting.status()).toBe(true)
    expect(deps.relabel).toHaveBeenCalledOnce()
    expect(deps.install).not.toHaveBeenCalled()
  })

  it('never relabels from a development, e2e or preview build', async () => {
    // `automatic` is false for all of them. Under --e2e the exe is a throwaway
    // build, and no write of any kind may reach the owner's real menu from it.
    const { state, setting, deps } = fixture(false)
    state.present = state.owned = true
    expect(await setting.status()).toBe(true)
    expect(deps.relabel).not.toHaveBeenCalled()
  })

  it('does not relabel what the user turned off', async () => {
    const { state, setting, deps } = fixture()
    state.off = true
    expect(await setting.status()).toBe(false)
    expect(deps.relabel).not.toHaveBeenCalled()
    expect(deps.install).not.toHaveBeenCalled()
    // Even with keys still there (a removal that failed, or a hand-made
    // entry): somebody who said no gets no registry write from Prism at all.
    state.present = state.owned = true
    expect(await setting.status()).toBe(true)
    expect(deps.relabel).not.toHaveBeenCalled()
  })

  it('does not relabel a verb it has just written, which is current by construction', async () => {
    const { setting, deps } = fixture()
    expect(await setting.status()).toBe(true)
    expect(deps.install).toHaveBeenCalledOnce()
    expect(deps.relabel).not.toHaveBeenCalled()
  })

  it('looks once per launch, not every time Settings asks for the status', async () => {
    // Settings reads the status each time the page opens, and a relabel check
    // is six reg.exe spawns to learn what the first one already settled.
    const { state, setting, deps } = fixture()
    state.present = state.owned = true
    await setting.status()
    await setting.status()
    await setting.status()
    expect(deps.relabel).toHaveBeenCalledOnce()
  })

  it('still reports the verb as on when the relabel itself fails', async () => {
    // The switch reports what the REGISTRY says. A label that could not be
    // rewritten is an old label on a working verb, not a verb that is off.
    const { state, setting, deps } = fixture()
    state.present = state.owned = true
    deps.relabel.mockRejectedValueOnce(new Error('Access denied'))
    expect(await setting.status()).toBe(true)
  })

  it('queues the relabel with everything else, so an explicit off cannot race it', async () => {
    const { state, setting, deps } = fixture()
    state.present = state.owned = true
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    deps.relabel.mockImplementationOnce(async () => {
      await gate
      return true
    })
    const startup = setting.status()
    const off = setting.set(false)
    await vi.waitFor(() => expect(deps.relabel).toHaveBeenCalledOnce())
    expect(deps.remove).not.toHaveBeenCalled()
    finish()
    expect(await startup).toBe(true)
    expect(await off).toBe(true)
    expect(state).toEqual({ present: false, owned: false, off: true })
  })

  it('does not report an unverified registration as enabled', async () => {
    const { setting, deps } = fixture()
    deps.installed.mockResolvedValue(false)
    expect(await setting.status()).toBe(false)
    expect(await setting.set(true)).toBe(false)
  })
})
