import { afterEach, describe, expect, it, vi } from 'vitest'
import { addressBarMenu } from './addressBar'
import { aliasWindow, clearHost, setHost } from '../testing/host'

aliasWindow()

afterEach(clearHost)

describe('addressBarMenu', () => {
  it('offers the folder and its path as text, then editing', () => {
    const copyAddress = vi.fn(() => Promise.resolve(true))
    setHost({ copyAddress })
    const onEdit = vi.fn()
    const items = addressBarMenu({ path: 'C:\\a', onEdit })
    expect(items.map((i) => i.label)).toEqual([
      'Copy address',
      'Copy address as text',
      'Edit address'
    ])
    expect(items[2].hint).toBe('Ctrl+L')
    items[0].onPick?.()
    expect(copyAddress).toHaveBeenCalledWith('C:\\a')
    items[2].onPick?.()
    expect(onEdit).toHaveBeenCalled()
  })
})
