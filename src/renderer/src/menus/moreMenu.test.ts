import { describe, expect, it, vi } from 'vitest'
import { titleBarMoreMenu } from './moreMenu'

describe('titleBarMoreMenu', () => {
  it('offers Phone', () => {
    const openPhone = vi.fn()
    const items = titleBarMoreMenu({ openPhone })
    expect(items.map((i) => i.label)).toEqual(['Phone'])
    items[0].onPick?.()
    expect(openPhone).toHaveBeenCalled()
  })
})
