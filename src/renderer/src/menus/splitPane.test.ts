import { describe, expect, it, vi } from 'vitest'
import { splitPaneMenu } from './splitPane'

describe('splitPaneMenu', () => {
  it('offers the position submenu, then removal', () => {
    const onMove = vi.fn()
    const onClose = vi.fn()
    const items = splitPaneMenu({ dir: 'top', onMove, onClose })
    expect(items.map((i) => i.label)).toEqual(['Split view position', 'Remove from split view'])
    expect(items[0].children?.map((i) => i.label)).toEqual(['Left', 'Right', 'Top', 'Bottom'])
    items[0].children?.[3].onPick?.()
    expect(onMove).toHaveBeenCalledWith('bottom')
    items[1].onPick?.()
    expect(onClose).toHaveBeenCalled()
  })
})
