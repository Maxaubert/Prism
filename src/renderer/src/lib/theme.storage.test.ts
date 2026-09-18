import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let events: EventTarget
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  events = new EventTarget()
  vi.stubGlobal('window', events)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

function changed(key: string): void {
  events.dispatchEvent(Object.assign(new Event('storage'), { key, storageArea: localStorage }))
}

describe('theme changes received from another Prism window', () => {
  it("preserves the other window's preset when saving another preset locally", async () => {
    const theme = await import('./theme')
    const remote = { ...theme.STYLES[0], id: 'remote', name: 'Custom theme 1', custom: true }
    localStorage.setItem('prism.style.presets', JSON.stringify([remote]))
    const writes = vi.spyOn(localStorage, 'setItem')
    changed('prism.style.presets')
    expect(writes).not.toHaveBeenCalled()
    expect(theme.allStyles()).toContainEqual(remote)

    theme.savePreset()
    const saved = JSON.parse(localStorage.getItem('prism.style.presets')!) as (typeof remote)[]
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual(remote)
    expect(saved[1].name).toBe('Custom theme 2')
  })

  it('does not resurrect a preset removed in another window', async () => {
    const theme = await import('./theme')
    theme.savePreset()
    const removedId = theme.allStyles().find((style) => style.custom)!.id
    localStorage.setItem('prism.style.presets', '[]')
    changed('prism.style.presets')
    expect(theme.allStyles().some((style) => style.id === removedId)).toBe(false)
    theme.savePreset()
    expect(JSON.parse(localStorage.getItem('prism.style.presets')!)).toHaveLength(1)
  })

  it('retains received overrides when changing a different appearance option', async () => {
    const theme = await import('./theme')
    localStorage.setItem(
      'prism.style.draft',
      JSON.stringify({ accent: '#123456', font: 'georgia' })
    )
    changed('prism.style.draft')
    theme.setAcrylic(25)
    expect(JSON.parse(localStorage.getItem('prism.style.draft')!)).toEqual({
      accent: '#123456',
      font: 'georgia',
      acrylic: 25
    })
    localStorage.removeItem('prism.style.draft')
    changed('prism.style.draft')
    theme.setAcrylic(30)
    expect(JSON.parse(localStorage.getItem('prism.style.draft')!)).toEqual({ acrylic: 30 })
  })

  it('adopts the received style even when its custom preset arrives afterward', async () => {
    const theme = await import('./theme')
    const remote = { ...theme.STYLES[0], id: 'remote', name: 'Remote', bg: '#123456', custom: true }
    localStorage.setItem('prism.style', remote.id)
    changed('prism.style')
    localStorage.setItem('prism.style.presets', JSON.stringify([remote]))
    changed('prism.style.presets')
    theme.savePreset()
    const saved = JSON.parse(localStorage.getItem('prism.style.presets')!) as (typeof remote)[]
    expect(saved[1].bg).toBe('#123456')
  })
})
