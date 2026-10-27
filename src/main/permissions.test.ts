import { describe, expect, it } from 'vitest'
import { permissionAllowed } from './permissions'

describe('permissionAllowed', () => {
  it('refuses the microphone and the camera', () => {
    expect(permissionAllowed('media')).toBe(false)
  })

  it('leaves every other permission at Electron default (granted)', () => {
    for (const p of ['clipboard-read', 'fullscreen', 'notifications', 'window-management']) {
      expect(permissionAllowed(p)).toBe(true)
    }
  })
})
