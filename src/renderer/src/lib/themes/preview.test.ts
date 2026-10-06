import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// THE WALL'S DELETE LANDS ON THE CARD IT IS PREVIEWING (#298 review): the
// arrows preview the card they reach, and Delete on an own copy's card deletes
// that copy. The preview has to go with it, or the window keeps painting a
// theme that no longer exists and keeping it (the focus leaving the wall)
// stores the fallback, Aurora, in place of the theme that was kept.

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
  const win = Object.assign(new EventTarget(), { prism: { setWindowMaterial: vi.fn() } })
  vi.stubGlobal('window', win)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('deleting the previewed own copy goes back to the kept theme', async () => {
  localStorage.setItem('prism.style', 'paper')
  const theme = await import('../theme')
  theme.setOverride('accent', '#22aa66')
  theme.savePreset()
  const own = theme.currentStyle().id
  theme.setStyle('carbon')
  const material = (window as unknown as { prism: { setWindowMaterial: ReturnType<typeof vi.fn> } }).prism.setWindowMaterial
  theme.previewStyle(own)
  vi.advanceTimersByTime(500)
  expect(material).toHaveBeenLastCalledWith('none', 'light')
  theme.deletePreset(own)
  vi.advanceTimersByTime(500)
  // Painted back in the kept theme, not left on the deleted one.
  expect(material).toHaveBeenLastCalledWith('none', 'dark')
  // Nothing previewed is left to keep: a second "go back" changes nothing.
  material.mockClear()
  theme.previewStyle(null)
  expect(material).not.toHaveBeenCalled()
  expect(theme.currentStyle().id).toBe('carbon')
})
