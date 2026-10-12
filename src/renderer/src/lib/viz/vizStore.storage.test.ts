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

describe('visualizer lists received from another Prism window', () => {
  it("preserves another window's saved preset when saving locally without echoing the received list", async () => {
    const viz = await import('./vizStore')
    const remote = { ...viz.vizState().presets[0], id: 'remote', name: 'Remote' }
    localStorage.setItem('prism.viz.presets', JSON.stringify([remote]))
    const writes = vi.spyOn(localStorage, 'setItem')
    changed('prism.viz.presets')
    expect(writes).not.toHaveBeenCalled()
    viz.savePreset('Local')
    const saved = JSON.parse(localStorage.getItem('prism.viz.presets')!) as (typeof remote)[]
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual(remote)
    expect(saved[1].name).toBe('Local')
  })

  it('does not resurrect a deleted preset when saving or deleting another locally', async () => {
    const viz = await import('./vizStore')
    const kept = viz.vizState().presets[0]
    const gone = viz.vizState().presets[1]
    localStorage.setItem('prism.viz.presets', JSON.stringify([kept]))
    changed('prism.viz.presets')
    viz.savePreset('Local')
    viz.deletePreset(kept.id)
    const saved = JSON.parse(localStorage.getItem('prism.viz.presets')!) as (typeof kept)[]
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('Local')
    expect(saved.some((entry) => entry.id === gone.id)).toBe(false)
  })

  it('retains remote hidden-theme choices during a local hide and honors remote restoration', async () => {
    const viz = await import('./vizStore')
    const [first, second] = viz.visibleThemes()
    localStorage.setItem('prism.viz.removedThemes', JSON.stringify([first.id]))
    const writes = vi.spyOn(localStorage, 'setItem')
    changed('prism.viz.removedThemes')
    expect(writes).not.toHaveBeenCalled()
    viz.removeTheme(second.id)
    expect(JSON.parse(localStorage.getItem('prism.viz.removedThemes')!)).toEqual([
      first.id,
      second.id
    ])
    localStorage.removeItem('prism.viz.removedThemes')
    changed('prism.viz.removedThemes')
    viz.removeTheme(second.id)
    expect(JSON.parse(localStorage.getItem('prism.viz.removedThemes')!)).toEqual([second.id])
  })
})
